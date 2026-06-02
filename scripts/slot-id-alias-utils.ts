import { asc } from "drizzle-orm";
import { db } from "../server/db.ts";
import {
  analyzeAbsenceAliasCandidate,
  analyzeRequestAliasCandidate,
  type AliasBackfillCandidate,
} from "../server/slotIdAliases.ts";
import { absences, classSlots, requests, slotIdAliases } from "../shared/schema.ts";
import { formatJstDate } from "../shared/jst.ts";
import { buildCanonicalSlotId } from "../shared/slotId.ts";

type DriftRow = {
  slotId: string;
  canonicalSlotId: string;
  dateISO: string;
  startTime: string;
  classBand: string;
  canonicalExists: boolean;
  aliasExists: boolean;
};

type AliasCandidateGroup = {
  legacySlotId: string;
  canonicalSlotIds: Set<string>;
  sources: string[];
  ambiguousCandidateSlotIds: Set<string>;
  hasUnresolvedSource: boolean;
};

export type AliasableCandidate = {
  legacySlotId: string;
  canonicalSlotId: string;
  sources: string[];
};

export type AmbiguousCandidate = {
  legacySlotId: string;
  candidateSlotIds: string[];
  sources: string[];
};

export type UnresolvedCandidate = {
  legacySlotId: string;
  sources: string[];
};

export type SlotIdAliasAnalysis = {
  summary: {
    slotsTotal: number;
    driftRowCount: number;
    existingAliasCount: number;
    unresolvedReferenceCount: number;
    aliasableCount: number;
    ambiguousCount: number;
  };
  driftRows: DriftRow[];
  aliasableCandidates: AliasableCandidate[];
  ambiguousCandidates: AmbiguousCandidate[];
  unresolvedCandidates: UnresolvedCandidate[];
};

function resolveCanonicalSlotId(slot: typeof classSlots.$inferSelect): string {
  const dateISO = formatJstDate(slot.date);
  const classBand = slot.classBand as "初級" | "中級" | "上級";
  return buildCanonicalSlotId(dateISO, slot.startTime, classBand);
}

function getOrCreateGroup(groups: Map<string, AliasCandidateGroup>, legacySlotId: string): AliasCandidateGroup {
  const existing = groups.get(legacySlotId);
  if (existing) {
    return existing;
  }

  const created: AliasCandidateGroup = {
    legacySlotId,
    canonicalSlotIds: new Set<string>(),
    sources: [],
    ambiguousCandidateSlotIds: new Set<string>(),
    hasUnresolvedSource: false,
  };
  groups.set(legacySlotId, created);
  return created;
}

function absorbCandidate(groups: Map<string, AliasCandidateGroup>, candidate: AliasBackfillCandidate | null) {
  if (!candidate) {
    return;
  }

  const group = getOrCreateGroup(groups, candidate.legacySlotId);
  group.sources.push(candidate.source);

  if (candidate.status === "aliasable") {
    group.canonicalSlotIds.add(candidate.canonicalSlotId);
    return;
  }

  if (candidate.status === "ambiguous") {
    for (const candidateSlotId of candidate.candidateSlotIds) {
      group.ambiguousCandidateSlotIds.add(candidateSlotId);
    }
    return;
  }

  group.hasUnresolvedSource = true;
}

export async function analyzeSlotIdAliases(): Promise<SlotIdAliasAnalysis> {
  const [slots, aliasRows, requestRows, absenceRows] = await Promise.all([
    db.select().from(classSlots).orderBy(asc(classSlots.date), asc(classSlots.startTime)),
    db.select().from(slotIdAliases).orderBy(asc(slotIdAliases.legacySlotId)),
    db.select({
      id: requests.id,
      toSlotId: requests.toSlotId,
      toSlotStartDateTime: requests.toSlotStartDateTime,
      declaredClassBand: requests.declaredClassBand,
    }).from(requests),
    db.select({
      id: absences.id,
      originalSlotId: absences.originalSlotId,
      absentDate: absences.absentDate,
      declaredClassBand: absences.declaredClassBand,
    }).from(absences),
  ]);

  const existingSlotIds = new Set(slots.map((slot) => slot.id));
  const aliasByLegacyId = new Map(aliasRows.map((row) => [row.legacySlotId, row]));
  const groups = new Map<string, AliasCandidateGroup>();

  const driftRows: DriftRow[] = [];
  for (const slot of slots) {
    const canonicalSlotId = resolveCanonicalSlotId(slot);
    if (canonicalSlotId === slot.id) {
      continue;
    }

    const aliasExists = aliasByLegacyId.has(slot.id);
    driftRows.push({
      slotId: slot.id,
      canonicalSlotId,
      dateISO: formatJstDate(slot.date),
      startTime: slot.startTime,
      classBand: slot.classBand,
      canonicalExists: existingSlotIds.has(canonicalSlotId),
      aliasExists,
    });

    if (!aliasExists) {
      absorbCandidate(groups, existingSlotIds.has(canonicalSlotId)
        ? {
            status: "aliasable",
            legacySlotId: slot.id,
            canonicalSlotId,
            source: `drifted_slot:${slot.id}`,
          }
        : {
            status: "unresolved",
            legacySlotId: slot.id,
            source: `drifted_slot:${slot.id}:canonical_missing`,
          });
    }
  }

  for (const requestRow of requestRows) {
    absorbCandidate(groups, await analyzeRequestAliasCandidate(db, requestRow));
  }

  for (const absenceRow of absenceRows) {
    absorbCandidate(groups, await analyzeAbsenceAliasCandidate(db, absenceRow));
  }

  const aliasableCandidates: AliasableCandidate[] = [];
  const ambiguousCandidates: AmbiguousCandidate[] = [];
  const unresolvedCandidates: UnresolvedCandidate[] = [];

  for (const group of groups.values()) {
    const canonicalSlotIds = Array.from(group.canonicalSlotIds);
    const ambiguousCandidateSlotIds = Array.from(group.ambiguousCandidateSlotIds);
    const sources = Array.from(new Set(group.sources));

    if (canonicalSlotIds.length === 1 && ambiguousCandidateSlotIds.length === 0) {
      aliasableCandidates.push({
        legacySlotId: group.legacySlotId,
        canonicalSlotId: canonicalSlotIds[0],
        sources,
      });
      continue;
    }

    if (canonicalSlotIds.length > 1 || ambiguousCandidateSlotIds.length > 0) {
      ambiguousCandidates.push({
        legacySlotId: group.legacySlotId,
        candidateSlotIds: Array.from(new Set([...canonicalSlotIds, ...ambiguousCandidateSlotIds])).sort(),
        sources,
      });
      continue;
    }

    if (group.hasUnresolvedSource) {
      unresolvedCandidates.push({
        legacySlotId: group.legacySlotId,
        sources,
      });
    }
  }

  aliasableCandidates.sort((a, b) => a.legacySlotId.localeCompare(b.legacySlotId));
  ambiguousCandidates.sort((a, b) => a.legacySlotId.localeCompare(b.legacySlotId));
  unresolvedCandidates.sort((a, b) => a.legacySlotId.localeCompare(b.legacySlotId));

  return {
    summary: {
      slotsTotal: slots.length,
      driftRowCount: driftRows.length,
      existingAliasCount: aliasRows.length,
      unresolvedReferenceCount: unresolvedCandidates.length,
      aliasableCount: aliasableCandidates.length,
      ambiguousCount: ambiguousCandidates.length,
    },
    driftRows,
    aliasableCandidates,
    ambiguousCandidates,
    unresolvedCandidates,
  };
}
