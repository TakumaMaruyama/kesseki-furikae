import { asc } from "drizzle-orm";
import { db } from "../server/db.ts";
import { absences, classSlots, closureEventSlots, requests } from "../shared/schema.ts";
import { formatJstDate } from "../shared/jst.ts";
import { buildCanonicalSlotId, parseSlotId } from "../shared/slotId.ts";

type ClassSlotRow = typeof classSlots.$inferSelect;

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

  const mismatchRows = slots
    .map((slot) => {
      const canonicalSlotId = resolveCanonicalSlotId(slot);
      if (canonicalSlotId === slot.id) {
        return null;
      }

      const idInfo = parseSlotId(slot.id);
      const requestRefs = requestCountBySlotId.get(slot.id) || 0;
      const absenceRefs = absenceCountBySlotId.get(slot.id) || 0;
      const closureRefs = closureCountBySlotId.get(slot.id) || 0;
      const totalRefs = requestRefs + absenceRefs + closureRefs;

      return {
        slotId: slot.id,
        canonicalSlotId,
        dateISO: formatJstDate(slot.date),
        startTime: slot.startTime,
        classBand: slot.classBand,
        idDateISO: idInfo?.dateISO || null,
        idStartTime: idInfo?.startTime || null,
        idClassBand: idInfo?.classBand || null,
        requestRefs,
        absenceRefs,
        closureRefs,
        totalRefs,
        canonicalExists: existingSlotIds.has(canonicalSlotId),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const collisionRows = mismatchRows.filter((row) => row.canonicalExists);
  const referencedRows = mismatchRows.filter((row) => row.totalRefs > 0);

  const summary = {
    slots_total: slots.length,
    slot_id_drift_count: mismatchRows.length,
    slot_id_drift_with_references_count: referencedRows.length,
    slot_id_drift_collision_count: collisionRows.length,
    request_refs_total: requestRows.length,
    absence_refs_total: absenceRows.length,
    closure_slot_refs_total: closureRows.length,
  };

  console.log("[slots:audit-id] Summary");
  console.table(summary);

  if (mismatchRows.length > 0) {
    console.log("[slots:audit-id] Drift rows (up to 100)");
    console.table(mismatchRows.slice(0, 100));
  }

  if (collisionRows.length > 0) {
    console.log("[slots:audit-id] Drift rows with canonical ID collision (up to 100)");
    console.table(collisionRows.slice(0, 100));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[slots:audit-id] Failed:", error);
    process.exit(1);
  });
