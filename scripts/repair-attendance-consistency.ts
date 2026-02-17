import { asc, eq } from "drizzle-orm";
import { db } from "../server/db.ts";
import { absences, classSlots, requests } from "../shared/schema.ts";
import { getActualCurrent } from "../shared/capacity.ts";

type SlotRepairTarget = {
  slotId: string;
  oldCapacityCurrent: number;
  oldCapacityMakeupUsed: number;
  newCapacityCurrent: number;
  newCapacityMakeupUsed: number;
  confirmedCount: number;
  reason: string;
};

async function main() {
  const shouldApply = process.argv.includes("--apply");

  const allSlots = await db
    .select()
    .from(classSlots)
    .orderBy(asc(classSlots.date), asc(classSlots.startTime));

  const allRequests = await db
    .select({
      id: requests.id,
      toSlotId: requests.toSlotId,
      status: requests.status,
    })
    .from(requests);

  const allAbsences = await db
    .select({
      id: absences.id,
      makeupStatus: absences.makeupStatus,
    })
    .from(absences);

  const confirmedBySlotId = new Map<string, number>();
  for (const row of allRequests) {
    if (row.status === "確定") {
      confirmedBySlotId.set(row.toSlotId, (confirmedBySlotId.get(row.toSlotId) || 0) + 1);
    }
  }

  const absenceNormalizeTargets = allAbsences
    .filter((row) => row.makeupStatus === "EXPIRED")
    .map((row) => row.id);

  const requestNormalizeTargets = allRequests
    .filter((row) => row.status === "キャンセル" || row.status === "辞退")
    .map((row) => row.id);

  const slotTargets: SlotRepairTarget[] = allSlots
    .map((slot) => {
      const confirmedCount = confirmedBySlotId.get(slot.id) || 0;
      const storedMakeupUsed = slot.capacityMakeupUsed || 0;

      const targetMakeupUsed = confirmedCount;
      const maxCurrentAllowed = Math.max(0, slot.capacityLimit - targetMakeupUsed);
      const targetCurrent = Math.max(0, Math.min(slot.capacityCurrent, maxCurrentAllowed));

      const reason: string[] = [];
      if (storedMakeupUsed !== targetMakeupUsed) {
        reason.push("capacityMakeupUsed_recalc");
      }
      if (slot.capacityCurrent !== targetCurrent) {
        reason.push("capacityCurrent_clamp");
      }

      if (reason.length === 0) {
        return null;
      }

      return {
        slotId: slot.id,
        oldCapacityCurrent: slot.capacityCurrent,
        oldCapacityMakeupUsed: storedMakeupUsed,
        newCapacityCurrent: targetCurrent,
        newCapacityMakeupUsed: targetMakeupUsed,
        confirmedCount,
        reason: reason.join(","),
      };
    })
    .filter((row): row is SlotRepairTarget => row !== null);

  const unresolvedOverbooked = allSlots
    .map((slot) => {
      const confirmedCount = confirmedBySlotId.get(slot.id) || 0;
      const targetCurrent = Math.max(0, Math.min(slot.capacityCurrent, Math.max(0, slot.capacityLimit - confirmedCount)));
      const projectedActualCurrent = targetCurrent + confirmedCount;
      return {
        slotId: slot.id,
        capacityLimit: slot.capacityLimit,
        confirmedCount,
        projectedActualCurrent,
      };
    })
    .filter((row) => row.projectedActualCurrent > row.capacityLimit);

  const summary = {
    mode: shouldApply ? "apply" : "dry-run",
    target_absences_expired_to_cancelled: absenceNormalizeTargets.length,
    target_requests_cancel_or_decline_to_kyakka: requestNormalizeTargets.length,
    target_slots_capacity_recalc: slotTargets.length,
    unresolved_overbooked_slots: unresolvedOverbooked.length,
  };

  console.log("[slots:repair-attendance] Summary");
  console.table(summary);

  if (slotTargets.length > 0) {
    console.log("[slots:repair-attendance] Slot repair targets (up to 100)");
    console.table(slotTargets.slice(0, 100));
  }

  if (unresolvedOverbooked.length > 0) {
    console.log("[slots:repair-attendance] Unresolved overbooked slots (confirmed > limit, up to 100)");
    console.table(unresolvedOverbooked.slice(0, 100));
  }

  if (!shouldApply) {
    console.log("[slots:repair-attendance] Dry run only. Re-run with --apply to persist changes.");
    return;
  }

  await db.transaction(async (tx) => {
    for (const absenceId of absenceNormalizeTargets) {
      await tx
        .update(absences)
        .set({
          makeupStatus: "CANCELLED",
          updatedAt: new Date(),
        })
        .where(eq(absences.id, absenceId));
    }

    for (const requestId of requestNormalizeTargets) {
      await tx
        .update(requests)
        .set({
          status: "却下",
        })
        .where(eq(requests.id, requestId));
    }

    for (const target of slotTargets) {
      await tx
        .update(classSlots)
        .set({
          capacityCurrent: target.newCapacityCurrent,
          capacityMakeupUsed: target.newCapacityMakeupUsed,
          updatedAt: new Date(),
        })
        .where(eq(classSlots.id, target.slotId));
    }
  });

  const updatedSlots = await db
    .select()
    .from(classSlots)
    .orderBy(asc(classSlots.date), asc(classSlots.startTime));

  const overCapacityAfterRepair = updatedSlots
    .map((slot) => ({
      slotId: slot.id,
      actualCurrent: getActualCurrent(slot),
      capacityLimit: slot.capacityLimit,
    }))
    .filter((row) => row.actualCurrent > row.capacityLimit);

  console.log("[slots:repair-attendance] Completed.");
  console.table({
    updated_absences: absenceNormalizeTargets.length,
    updated_requests: requestNormalizeTargets.length,
    updated_slots: slotTargets.length,
    over_capacity_after_repair: overCapacityAfterRepair.length,
  });

  if (overCapacityAfterRepair.length > 0) {
    console.log("[slots:repair-attendance] Remaining over-capacity slots (up to 100)");
    console.table(overCapacityAfterRepair.slice(0, 100));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[slots:repair-attendance] Failed:", error);
    process.exit(1);
  });

