import { asc } from "drizzle-orm";
import { db } from "../server/db.ts";
import { classSlots } from "../shared/schema.ts";
import { analyzeSlotTimeDrift } from "./slot-time-drift-utils.ts";

async function main() {
  const slots = await db
    .select()
    .from(classSlots)
    .orderBy(asc(classSlots.date), asc(classSlots.startTime));

  const analyses = slots.map(analyzeSlotTimeDrift);

  const summary = {
    scannedTotal: analyses.length,
    idParsable: analyses.filter((a) => a.idParsable).length,
    idTimeMatchesStartTime: analyses.filter((a) => a.idParsable && a.timeMatchesId).length,
    hasOneDayDateDrift: analyses.filter((a) => a.idParsable && a.timeMatchesId && a.hasOneDayDateDrift).length,
    editedAfterCreation: analyses.filter((a) => a.idParsable && a.timeMatchesId && a.isEditedAfterCreation).length,
    autoRepairEligible: analyses.filter((a) => a.autoRepairEligible).length,
    needsManualReview: analyses.filter(
      (a) => a.idParsable && a.timeMatchesId && a.hasOneDayDateDrift && !a.isEditedAfterCreation,
    ).length,
  };

  console.log("[slots:audit-time] Summary");
  console.table(summary);

  const autoRepairCandidates = analyses.filter((a) => a.autoRepairEligible);
  if (autoRepairCandidates.length > 0) {
    console.log("[slots:audit-time] Auto-repair candidates (up to 50 rows)");
    console.table(
      autoRepairCandidates.slice(0, 50).map((a) => ({
        slotId: a.slot.id,
        classBand: a.slot.classBand,
        startTime: a.slot.startTime,
        columnDate: a.columnDateISO,
        idDate: a.idDateISO,
        dayDiffFromId: a.dayDiffFromId,
      })),
    );
  }

  const manualReviewCandidates = analyses.filter(
    (a) => a.idParsable && a.timeMatchesId && a.hasOneDayDateDrift && !a.isEditedAfterCreation,
  );
  if (manualReviewCandidates.length > 0) {
    console.log("[slots:audit-time] Manual review candidates (up to 50 rows)");
    console.table(
      manualReviewCandidates.slice(0, 50).map((a) => ({
        slotId: a.slot.id,
        classBand: a.slot.classBand,
        startTime: a.slot.startTime,
        columnDate: a.columnDateISO,
        idDate: a.idDateISO,
        dayDiffFromId: a.dayDiffFromId,
        createdAt: a.slot.createdAt,
        updatedAt: a.slot.updatedAt,
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
