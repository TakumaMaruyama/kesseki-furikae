import { asc, eq } from "drizzle-orm";
import { db } from "../server/db.ts";
import { classSlots, requests } from "../shared/schema.ts";
import { parseJstDate, parseJstDateTime } from "../shared/jst.ts";
import { analyzeSlotTimeDrift } from "./slot-time-drift-utils.ts";

async function main() {
  const shouldApply = process.argv.includes("--apply");

  const slots = await db
    .select()
    .from(classSlots)
    .orderBy(asc(classSlots.date), asc(classSlots.startTime));

  const analyses = slots.map(analyzeSlotTimeDrift);
  const candidates = analyses.filter((a) => a.autoRepairEligible);

  console.log(`[slots:repair-time] Mode: ${shouldApply ? "apply" : "dry-run"}`);
  console.log(`[slots:repair-time] Auto-repair eligible slots: ${candidates.length}`);

  if (candidates.length === 0) {
    console.log("[slots:repair-time] No repair targets found.");
    return;
  }

  console.table(
    candidates.slice(0, 50).map((a) => ({
      slotId: a.slot.id,
      classBand: a.slot.classBand,
      startTime: a.slot.startTime,
      fromDate: a.columnDateISO,
      toDate: a.idDateISO,
      dayDiffFromId: a.dayDiffFromId,
    })),
  );

  if (!shouldApply) {
    console.log("[slots:repair-time] Dry run only. Re-run with --apply to persist changes.");
    return;
  }

  let updatedSlotCount = 0;
  let updatedRequestCount = 0;

  await db.transaction(async (tx) => {
    for (const candidate of candidates) {
      if (!candidate.idDateISO) continue;

      const correctedDate = parseJstDate(candidate.idDateISO);
      const correctedStartDateTime = parseJstDateTime(candidate.idDateISO, candidate.slot.startTime);

      await tx
        .update(classSlots)
        .set({
          date: correctedDate,
          lessonStartDateTime: correctedStartDateTime,
        })
        .where(eq(classSlots.id, candidate.slot.id));

      const updatedRequests = await tx
        .update(requests)
        .set({
          toSlotStartDateTime: correctedStartDateTime,
        })
        .where(eq(requests.toSlotId, candidate.slot.id))
        .returning({ id: requests.id });

      updatedSlotCount += 1;
      updatedRequestCount += updatedRequests.length;
    }
  });

  console.log("[slots:repair-time] Completed.");
  console.log(`[slots:repair-time] Updated class_slots rows: ${updatedSlotCount}`);
  console.log(`[slots:repair-time] Updated requests rows: ${updatedRequestCount}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[slots:repair-time] Failed:", error);
    process.exit(1);
  });
