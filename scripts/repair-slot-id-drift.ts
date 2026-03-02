import { asc, eq } from "drizzle-orm";
import { db } from "../server/db.ts";
import { absences, classSlots, closureEventSlots, requests } from "../shared/schema.ts";
import { formatJstDate, parseJstDateTime } from "../shared/jst.ts";
import { buildCanonicalSlotId } from "../shared/slotId.ts";

type ClassSlotRow = typeof classSlots.$inferSelect;

type DriftTarget = {
  oldSlotId: string;
  canonicalSlotId: string;
  requestRefs: number;
  absenceRefs: number;
  closureRefs: number;
  canonicalSlotStartDateTime: Date;
  slot: ClassSlotRow;
};

type CollisionTarget = DriftTarget & {
  conflictReason: "canonical_id_exists" | "duplicate_canonical_target";
};

function incrementCount(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) || 0) + 1);
}

function buildReferenceCountMap(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    incrementCount(counts, value);
  }
  return counts;
}

function resolveCanonicalSlotId(slot: ClassSlotRow): string {
  const dateISO = formatJstDate(slot.date);
  const classBand = slot.classBand as "初級" | "中級" | "上級";
  return buildCanonicalSlotId(dateISO, slot.startTime, classBand);
}

async function main() {
  const shouldApply = process.argv.includes("--apply");

  const slots = await db
    .select()
    .from(classSlots)
    .orderBy(asc(classSlots.date), asc(classSlots.startTime));

  const requestRows = await db
    .select({
      toSlotId: requests.toSlotId,
    })
    .from(requests);

  const absenceRows = await db
    .select({
      originalSlotId: absences.originalSlotId,
    })
    .from(absences);

  const closureRows = await db
    .select({
      slotId: closureEventSlots.slotId,
    })
    .from(closureEventSlots);

  const requestCountBySlotId = buildReferenceCountMap(requestRows.map((row) => row.toSlotId));
  const absenceCountBySlotId = buildReferenceCountMap(absenceRows.map((row) => row.originalSlotId));
  const closureCountBySlotId = buildReferenceCountMap(closureRows.map((row) => row.slotId));

  const existingSlotIds = new Set(slots.map((slot) => slot.id));

  const rawTargets = slots
    .map((slot) => {
      const canonicalSlotId = resolveCanonicalSlotId(slot);
      if (canonicalSlotId === slot.id) {
        return null;
      }

      const canonicalSlotStartDateTime = parseJstDateTime(formatJstDate(slot.date), slot.startTime);

      return {
        oldSlotId: slot.id,
        canonicalSlotId,
        requestRefs: requestCountBySlotId.get(slot.id) || 0,
        absenceRefs: absenceCountBySlotId.get(slot.id) || 0,
        closureRefs: closureCountBySlotId.get(slot.id) || 0,
        canonicalSlotStartDateTime,
        slot,
      } satisfies DriftTarget;
    })
    .filter((row): row is DriftTarget => row !== null);

  const canonicalTargetCounts = new Map<string, number>();
  for (const target of rawTargets) {
    incrementCount(canonicalTargetCounts, target.canonicalSlotId);
  }

  const repairTargets: DriftTarget[] = [];
  const collisionTargets: CollisionTarget[] = [];

  for (const target of rawTargets) {
    if (existingSlotIds.has(target.canonicalSlotId)) {
      collisionTargets.push({ ...target, conflictReason: "canonical_id_exists" });
      continue;
    }

    if ((canonicalTargetCounts.get(target.canonicalSlotId) || 0) > 1) {
      collisionTargets.push({ ...target, conflictReason: "duplicate_canonical_target" });
      continue;
    }

    repairTargets.push(target);
  }

  const summary = {
    mode: shouldApply ? "apply" : "dry-run",
    slots_total: slots.length,
    drift_targets_total: rawTargets.length,
    executable_targets_total: repairTargets.length,
    collision_targets_total: collisionTargets.length,
  };

  console.log("[slots:repair-id] Summary");
  console.table(summary);

  if (repairTargets.length > 0) {
    console.log("[slots:repair-id] Executable repair targets (up to 100)");
    console.table(
      repairTargets.slice(0, 100).map((target) => ({
        oldSlotId: target.oldSlotId,
        canonicalSlotId: target.canonicalSlotId,
        requestRefs: target.requestRefs,
        absenceRefs: target.absenceRefs,
        closureRefs: target.closureRefs,
      })),
    );
  }

  if (collisionTargets.length > 0) {
    console.log("[slots:repair-id] Collision targets (up to 100)");
    console.table(
      collisionTargets.slice(0, 100).map((target) => ({
        oldSlotId: target.oldSlotId,
        canonicalSlotId: target.canonicalSlotId,
        conflictReason: target.conflictReason,
      })),
    );
  }

  if (!shouldApply) {
    console.log("[slots:repair-id] Dry run only. Re-run with --apply to persist changes.");
    return;
  }

  let appliedCount = 0;
  const failures: Array<{ oldSlotId: string; canonicalSlotId: string; reason: string }> = [];

  for (const target of repairTargets) {
    try {
      await db.transaction(async (tx) => {
        await tx
          .insert(classSlots)
          .values({
            id: target.canonicalSlotId,
            date: target.slot.date,
            startTime: target.slot.startTime,
            courseLabel: target.slot.courseLabel,
            classBand: target.slot.classBand,
            isClosed: target.slot.isClosed,
            capacityLimit: target.slot.capacityLimit,
            capacityCurrent: target.slot.capacityCurrent,
            capacityMakeupUsed: target.slot.capacityMakeupUsed || 0,
            waitlistCount: target.slot.waitlistCount || 0,
            lessonStartDateTime: target.slot.lessonStartDateTime || target.canonicalSlotStartDateTime,
            lastNotifiedRequestId: target.slot.lastNotifiedRequestId || null,
            createdAt: target.slot.createdAt,
            updatedAt: new Date(),
          });

        await tx
          .update(requests)
          .set({
            toSlotId: target.canonicalSlotId,
            toSlotStartDateTime: target.canonicalSlotStartDateTime,
          })
          .where(eq(requests.toSlotId, target.oldSlotId));

        await tx
          .update(absences)
          .set({
            originalSlotId: target.canonicalSlotId,
            updatedAt: new Date(),
          })
          .where(eq(absences.originalSlotId, target.oldSlotId));

        await tx
          .update(closureEventSlots)
          .set({
            slotId: target.canonicalSlotId,
          })
          .where(eq(closureEventSlots.slotId, target.oldSlotId));

        await tx.delete(classSlots).where(eq(classSlots.id, target.oldSlotId));
      });

      appliedCount += 1;
    } catch (error: any) {
      failures.push({
        oldSlotId: target.oldSlotId,
        canonicalSlotId: target.canonicalSlotId,
        reason: error?.message || "unknown_error",
      });
    }
  }

  console.log("[slots:repair-id] Completed.");
  console.table({
    applied_targets: appliedCount,
    failed_targets: failures.length,
    skipped_collision_targets: collisionTargets.length,
  });

  if (failures.length > 0) {
    console.log("[slots:repair-id] Failed targets");
    console.table(failures);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[slots:repair-id] Failed:", error);
    process.exit(1);
  });
