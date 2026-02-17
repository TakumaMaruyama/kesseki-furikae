import { asc } from "drizzle-orm";
import { db } from "../server/db.ts";
import { absences, classSlots, requests } from "../shared/schema.ts";
import { getActualCurrent, getRemainingCapacity } from "../shared/capacity.ts";

function incrementMap(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) || 0) + 1);
}

async function main() {
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

  const requestStatusCounts = new Map<string, number>();
  const confirmedBySlotId = new Map<string, number>();

  for (const row of allRequests) {
    incrementMap(requestStatusCounts, row.status);
    if (row.status === "確定") {
      confirmedBySlotId.set(row.toSlotId, (confirmedBySlotId.get(row.toSlotId) || 0) + 1);
    }
  }

  const absenceStatusCounts = new Map<string, number>();
  for (const row of allAbsences) {
    incrementMap(absenceStatusCounts, row.makeupStatus);
  }

  const makeupMismatchRows = allSlots
    .map((slot) => {
      const confirmedCount = confirmedBySlotId.get(slot.id) || 0;
      const storedMakeupUsed = slot.capacityMakeupUsed || 0;
      return {
        slotId: slot.id,
        capacityLimit: slot.capacityLimit,
        capacityCurrent: slot.capacityCurrent,
        storedMakeupUsed,
        confirmedCount,
      };
    })
    .filter((row) => row.storedMakeupUsed !== row.confirmedCount);

  const overCapacityRows = allSlots
    .map((slot) => {
      const actualCurrent = getActualCurrent(slot);
      const remaining = getRemainingCapacity(slot);
      return {
        slotId: slot.id,
        capacityLimit: slot.capacityLimit,
        capacityCurrent: slot.capacityCurrent,
        capacityMakeupUsed: slot.capacityMakeupUsed,
        actualCurrent,
        remaining,
      };
    })
    .filter((row) => row.actualCurrent > row.capacityLimit);

  const summary = {
    slots_total: allSlots.length,
    requests_total: allRequests.length,
    absences_total: allAbsences.length,
    absences_expired_count: absenceStatusCounts.get("EXPIRED") || 0,
    absences_cancelled_count: absenceStatusCounts.get("CANCELLED") || 0,
    requests_cancel_status_kyakka: requestStatusCounts.get("却下") || 0,
    requests_cancel_status_cancel: requestStatusCounts.get("キャンセル") || 0,
    requests_cancel_status_decline: requestStatusCounts.get("辞退") || 0,
    makeup_used_mismatch_count: makeupMismatchRows.length,
    slot_over_capacity_count: overCapacityRows.length,
  };

  console.log("[slots:audit-attendance] Summary");
  console.table(summary);

  if (absenceStatusCounts.size > 0) {
    console.log("[slots:audit-attendance] Absence status counts");
    console.table(
      [...absenceStatusCounts.entries()].map(([status, count]) => ({
        status,
        count,
      })),
    );
  }

  if (requestStatusCounts.size > 0) {
    console.log("[slots:audit-attendance] Request status counts");
    console.table(
      [...requestStatusCounts.entries()].map(([status, count]) => ({
        status,
        count,
      })),
    );
  }

  if (makeupMismatchRows.length > 0) {
    console.log("[slots:audit-attendance] capacityMakeupUsed mismatch rows (up to 100)");
    console.table(makeupMismatchRows.slice(0, 100));
  }

  if (overCapacityRows.length > 0) {
    console.log("[slots:audit-attendance] Over-capacity rows (up to 100)");
    console.table(overCapacityRows.slice(0, 100));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[slots:audit-attendance] Failed:", error);
    process.exit(1);
  });

