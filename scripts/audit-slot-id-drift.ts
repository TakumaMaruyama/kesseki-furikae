import { analyzeSlotIdAliases } from "./slot-id-alias-utils.ts";

async function main() {
  const analysis = await analyzeSlotIdAliases();

  const summary = {
    slots_total: analysis.summary.slotsTotal,
    slot_id_drift_count: analysis.summary.driftRowCount,
    existing_alias_count: analysis.summary.existingAliasCount,
    unresolved_reference_count: analysis.summary.unresolvedReferenceCount,
    aliasable_count: analysis.summary.aliasableCount,
    ambiguous_count: analysis.summary.ambiguousCount,
  };

  console.log("[slots:audit-id] Summary");
  console.table(summary);

  if (analysis.driftRows.length > 0) {
    console.log("[slots:audit-id] Drift rows (up to 100)");
    console.table(analysis.driftRows.slice(0, 100));
  }

  if (analysis.aliasableCandidates.length > 0) {
    console.log("[slots:audit-id] Aliasable candidates (up to 100)");
    console.table(analysis.aliasableCandidates.slice(0, 100));
  }

  if (analysis.ambiguousCandidates.length > 0) {
    console.log("[slots:audit-id] Ambiguous candidates (up to 100)");
    console.table(analysis.ambiguousCandidates.slice(0, 100));
  }

  if (analysis.unresolvedCandidates.length > 0) {
    console.log("[slots:audit-id] Unresolved candidates (up to 100)");
    console.table(analysis.unresolvedCandidates.slice(0, 100));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[slots:audit-id] Failed:", error);
    process.exit(1);
  });
