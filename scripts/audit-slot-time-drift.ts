import { asc } from "drizzle-orm";
import { db } from "../server/db.ts";
import { classSlots, requests } from "../shared/schema.ts";
import { analyzeSlotTimeDrift } from "./slot-time-drift-utils.ts";

async function main() {
  const slots = await db
    .select()
    .from(classSlots)
    .orderBy(asc(classSlots.date), asc(classSlots.startTime));

  const analyses = slots.map(analyzeSlotTimeDrift);
  const analysisBySlotId = new Map(analyses.map((a) => [a.slot.id, a]));

  const requestRows = await db
    .select({
      id: requests.id,
      toSlotId: requests.toSlotId,
      toSlotStartDateTime: requests.toSlotStartDateTime,
    })
    .from(requests);

  const requestMismatches = requestRows
    .map((request) => {
      const slotAnalysis = analysisBySlotId.get(request.toSlotId);
      if (!slotAnalysis) {
        return null;
      }

      const stored = new Date(request.toSlotStartDateTime);
      const matchesCanonical = !Number.isNaN(stored.getTime()) &&
        stored.getTime() === slotAnalysis.canonicalFromColumns.getTime();
      if (matchesCanonical) {
        return null;
      }

      return {
        requestId: request.id,
        slotId: request.toSlotId,
        storedToSlotStartDateTime: request.toSlotStartDateTime,
        canonicalToSlotStartDateTime: slotAnalysis.canonicalFromColumns.toISOString(),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const summary = {
    scannedTotal: analyses.length,
    mismatch_lesson_start_count: analyses.filter((a) => !a.lessonStartMatchesCanonical).length,
    mismatch_request_start_count: requestMismatches.length,
    id_date_drift_count: analyses.filter((a) => a.idParsable && a.timeMatchesId && a.hasOneDayIdDateDrift).length,
  };

  console.log("[slots:audit-time] Summary");
  console.table(summary);

  const slotMismatches = analyses.filter((a) => !a.lessonStartMatchesCanonical);
  if (slotMismatches.length > 0) {
    console.log("[slots:audit-time] Slot lesson_start_date_time mismatches (up to 50 rows)");
    console.table(
      slotMismatches.slice(0, 50).map((a) => ({
        slotId: a.slot.id,
        classBand: a.slot.classBand,
        startTime: a.slot.startTime,
        columnDateISO: a.columnDateISO,
        storedLessonStartDateTime: a.storedLessonStartDateTime?.toISOString() || null,
        canonicalFromColumns: a.canonicalFromColumns.toISOString(),
      })),
    );
  }

  if (requestMismatches.length > 0) {
    console.log("[slots:audit-time] Request to_slot_start_date_time mismatches (up to 50 rows)");
    console.table(
      requestMismatches.slice(0, 50),
    );
  }

  const idDateDrifts = analyses.filter((a) => a.idParsable && a.timeMatchesId && a.hasOneDayIdDateDrift);
  if (idDateDrifts.length > 0) {
    console.log("[slots:audit-time] ID vs date drift rows (reference, up to 50 rows)");
    console.table(
      idDateDrifts.slice(0, 50).map((a) => ({
        slotId: a.slot.id,
        columnDateISO: a.columnDateISO,
        idDateISO: a.idDateISO,
        dayDiffFromId: a.dayDiffFromId,
        startTime: a.slot.startTime,
      })),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[slots:audit-time] Failed:", error);
    process.exit(1);
  });
