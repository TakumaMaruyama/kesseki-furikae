import { db } from "../server/db.ts";
import { upsertSlotIdAlias } from "../server/slotIdAliases.ts";
import { analyzeSlotIdAliases } from "./slot-id-alias-utils.ts";

async function main() {
  const shouldApply = process.argv.includes("--apply");
  const analysis = await analyzeSlotIdAliases();

  console.log("[slots:backfill-aliases] Summary");
  console.table({
    mode: shouldApply ? "apply" : "dry-run",
    ...analysis.summary,
  });

  if (analysis.aliasableCandidates.length > 0) {
    console.log("[slots:backfill-aliases] Aliasable candidates (up to 100)");
    console.table(analysis.aliasableCandidates.slice(0, 100));
  }

  if (analysis.ambiguousCandidates.length > 0) {
    console.log("[slots:backfill-aliases] Ambiguous candidates (up to 100)");
    console.table(analysis.ambiguousCandidates.slice(0, 100));
  }

  if (analysis.unresolvedCandidates.length > 0) {
    console.log("[slots:backfill-aliases] Unresolved candidates (up to 100)");
    console.table(analysis.unresolvedCandidates.slice(0, 100));
  }

  if (!shouldApply) {
    console.log("[slots:backfill-aliases] Dry run only. Re-run with --apply to persist aliases.");
    return;
  }

  let appliedCount = 0;
  for (const candidate of analysis.aliasableCandidates) {
    await upsertSlotIdAlias(db, {
      legacySlotId: candidate.legacySlotId,
      canonicalSlotId: candidate.canonicalSlotId,
      source: "backfill_slot_id_aliases",
    });
    appliedCount += 1;
  }

  console.log("[slots:backfill-aliases] Completed.");
  console.table({
    appliedAliases: appliedCount,
    ambiguousSkipped: analysis.ambiguousCandidates.length,
    unresolvedSkipped: analysis.unresolvedCandidates.length,
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[slots:backfill-aliases] Failed:", error);
    process.exit(1);
  });
