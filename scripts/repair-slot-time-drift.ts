import { asc, eq } from "drizzle-orm";
import { db } from "../server/db.ts";
import { classSlots, requests } from "../shared/schema.ts";
import { analyzeSlotTimeDrift } from "./slot-time-drift-utils.ts";

async function main() {
  const shouldApply = process.argv.includes("--apply");

  const slots = await db
    .select()
    .from(classSlots)
    .orderBy(asc(classSlots.date), asc(classSlots.startTime));

  const analyses = slots.map(analyzeSlotTimeDrift);
  const slotFixTargets = analyses.filter((a) => !a.lessonStartMatchesCanonical);
  const analysisBySlotId = new Map(analyses.map((a) => [a.slot.id, a]));

  const requestRows = await db
    .select({
      id: requests.id,
      toSlotId: requests.toSlotId,
      toSlotStartDateTime: requests.toSlotStartDateTime,
    })
    .from(requests);

  const requestFixTargets = requestRows
    .map((request) => {
      const slotAnalysis = analysisBySlotId.get(request.toSlotId);
      if (!slotAnalysis) return null;

      const stored = new Date(request.toSlotStartDateTime);
      const matchesCanonical = !Number.isNaN(stored.getTime()) &&
        stored.getTime() === slotAnalysis.canonicalFromColumns.getTime();
      if (matchesCanonical) return null;

      return {
        requestId: request.id,
        slotId: request.toSlotId,
        correctedToSlotStartDateTime: slotAnalysis.canonicalFromColumns,
        storedToSlotStartDateTime: request.toSlotStartDateTime,
      };
    })
    .filter((target): target is NonNullable<typeof target> => target !== null);

  const idDateDriftCount = analyses.filter((a) => a.idParsable && a.timeMatchesId && a.hasOneDayIdDateDrift).length;

  console.log(`[slots:repair-time] Mode: ${shouldApply ? "apply" : "dry-run"}`);
  console.log(`[slots:repair-time] Slot lesson_start_date_time targets: ${slotFixTargets.length}`);
  console.log(`[slots:repair-time] Request to_slot_start_date_time targets: ${requestFixTargets.length}`);
  console.log(`[slots:repair-time] id_date_drift_count (reference): ${idDateDriftCount}`);

  if (slotFixTargets.length > 0) {
    console.log("[slots:repair-time] Slot fix targets (up to 50 rows)");
    console.table(
      slotFixTargets.slice(0, 50).map((target) => ({
        slotId: target.slot.id,
        startTime: target.slot.startTime,
        columnDateISO: target.columnDateISO,
        storedLessonStartDateTime: target.storedLessonStartDateTime?.toISOString() || null,
        canonicalFromColumns: target.canonicalFromColumns.toISOString(),
      })),
    );
  }

  if (requestFixTargets.length > 0) {
    console.log("[slots:repair-time] Request fix targets (up to 50 rows)");
    console.table(
      requestFixTargets.slice(0, 50).map((target) => ({
        requestId: target.requestId,
        slotId: target.slotId,
        storedToSlotStartDateTime: target.storedToSlotStartDateTime,
        canonicalToSlotStartDateTime: target.correctedToSlotStartDateTime.toISOString(),
      })),
    );
  }

  if (slotFixTargets.length === 0 && requestFixTargets.length === 0) {
    console.log("[slots:repair-time] No repair targets found.");
    return;
  }

  if (!shouldApply) {
    console.log("[slots:repair-time] Dry run only. Re-run with --apply to persist changes.");
    return;
  }

  let updatedSlotCount = 0;
  let updatedRequestCount = 0;

  await db.transaction(async (tx) => {
    for (const target of slotFixTargets) {
      await tx
        .update(classSlots)
        .set({
          lessonStartDateTime: target.canonicalFromColumns,
        })
        .where(eq(classSlots.id, target.slot.id));

      updatedSlotCount += 1;
    }

    for (const target of requestFixTargets) {
      await tx
        .update(requests)
        .set({
          toSlotStartDateTime: target.correctedToSlotStartDateTime,
        })
        .where(eq(requests.id, target.requestId));

      updatedRequestCount += 1;
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
