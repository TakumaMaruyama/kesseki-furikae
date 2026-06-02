import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { endOfJstDay, startOfJstDay } from "@shared/jst";
import {
  classSlots,
  slotIdAliases,
  type Absence,
  type ClassSlot,
  type Request,
} from "@shared/schema";
import { parseSlotId } from "@shared/slotId";

type Executor = any;

export type ResolvedSlotReference = {
  slot: ClassSlot;
  canonicalSlotId: string;
  legacySlotIds: string[];
  knownSlotIds: string[];
};

export type AliasBackfillCandidate =
  | {
      status: "aliasable";
      legacySlotId: string;
      canonicalSlotId: string;
      source: string;
    }
  | {
      status: "ambiguous";
      legacySlotId: string;
      source: string;
      candidateSlotIds: string[];
    }
  | {
      status: "unresolved";
      legacySlotId: string;
      source: string;
    };

async function getSlotByExactId(executor: Executor, slotId: string): Promise<ClassSlot | undefined> {
  const [slot] = await executor
    .select()
    .from(classSlots)
    .where(eq(classSlots.id, slotId))
    .limit(1);
  return slot;
}

async function getAliasRowByLegacySlotId(executor: Executor, legacySlotId: string) {
  const [aliasRow] = await executor
    .select()
    .from(slotIdAliases)
    .where(eq(slotIdAliases.legacySlotId, legacySlotId))
    .limit(1);
  return aliasRow;
}

async function getLegacySlotIdsForCanonical(executor: Executor, canonicalSlotId: string): Promise<string[]> {
  const rows = await executor
    .select({ legacySlotId: slotIdAliases.legacySlotId })
    .from(slotIdAliases)
    .where(eq(slotIdAliases.canonicalSlotId, canonicalSlotId))
    .orderBy(asc(slotIdAliases.legacySlotId));

  return rows.map((row: { legacySlotId: string }) => row.legacySlotId);
}

async function buildResolvedSlotReference(executor: Executor, slot: ClassSlot): Promise<ResolvedSlotReference> {
  const legacySlotIds = await getLegacySlotIdsForCanonical(executor, slot.id);
  return {
    slot,
    canonicalSlotId: slot.id,
    legacySlotIds,
    knownSlotIds: [slot.id, ...legacySlotIds],
  };
}

async function resolveSlotByAlias(executor: Executor, legacySlotId: string): Promise<ResolvedSlotReference | undefined> {
  const aliasRow = await getAliasRowByLegacySlotId(executor, legacySlotId);
  if (!aliasRow) {
    return undefined;
  }

  const slot = await getSlotByExactId(executor, aliasRow.canonicalSlotId);
  if (!slot) {
    return undefined;
  }

  return buildResolvedSlotReference(executor, slot);
}

export async function resolveSlotReference(executor: Executor, slotId: string): Promise<ResolvedSlotReference | undefined> {
  const exactSlot = await getSlotByExactId(executor, slotId);
  if (exactSlot) {
    return buildResolvedSlotReference(executor, exactSlot);
  }

  return resolveSlotByAlias(executor, slotId);
}

export async function resolveSlotLookupIds(executor: Executor, slotId: string): Promise<string[]> {
  const resolved = await resolveSlotReference(executor, slotId);
  return resolved ? resolved.knownSlotIds : [slotId];
}

export async function upsertSlotIdAlias(
  executor: Executor,
  args: {
    legacySlotId: string;
    canonicalSlotId: string;
    source: string;
  },
): Promise<void> {
  if (args.legacySlotId === args.canonicalSlotId) {
    return;
  }

  await executor
    .insert(slotIdAliases)
    .values({
      legacySlotId: args.legacySlotId,
      canonicalSlotId: args.canonicalSlotId,
      source: args.source,
    })
    .onConflictDoUpdate({
      target: slotIdAliases.legacySlotId,
      set: {
        canonicalSlotId: args.canonicalSlotId,
        source: args.source,
      },
    });
}

async function resolveUniqueSlotCandidate(
  rows: ClassSlot[],
  legacySlotId: string,
  source: string,
): Promise<AliasBackfillCandidate> {
  if (rows.length === 0) {
    return {
      status: "unresolved",
      legacySlotId,
      source,
    };
  }

  if (rows.length > 1) {
    return {
      status: "ambiguous",
      legacySlotId,
      source,
      candidateSlotIds: rows.map((row) => row.id),
    };
  }

  return {
    status: "aliasable",
    legacySlotId,
    canonicalSlotId: rows[0].id,
    source,
  };
}

export async function analyzeRequestAliasCandidate(
  executor: Executor,
  request: Pick<Request, "id" | "toSlotId" | "toSlotStartDateTime" | "declaredClassBand">,
): Promise<AliasBackfillCandidate | null> {
  const resolved = await resolveSlotReference(executor, request.toSlotId);
  if (resolved) {
    return null;
  }

  if (!request.toSlotStartDateTime) {
    return {
      status: "unresolved",
      legacySlotId: request.toSlotId,
      source: `request:${request.id}:missing_to_slot_start_date_time`,
    };
  }

  const rows = await executor
    .select()
    .from(classSlots)
    .where(and(
      eq(classSlots.lessonStartDateTime, request.toSlotStartDateTime),
      eq(classSlots.classBand, request.declaredClassBand),
    ))
    .limit(2);

  return resolveUniqueSlotCandidate(rows, request.toSlotId, `request:${request.id}`);
}

export async function analyzeAbsenceAliasCandidate(
  executor: Executor,
  absence: Pick<Absence, "id" | "originalSlotId" | "absentDate" | "declaredClassBand">,
): Promise<AliasBackfillCandidate | null> {
  const resolved = await resolveSlotReference(executor, absence.originalSlotId);
  if (resolved) {
    return null;
  }

  const parsed = parseSlotId(absence.originalSlotId);
  if (!parsed) {
    return {
      status: "unresolved",
      legacySlotId: absence.originalSlotId,
      source: `absence:${absence.id}:unparseable_slot_id`,
    };
  }

  const dayStart = startOfJstDay(absence.absentDate);
  const dayEnd = endOfJstDay(absence.absentDate);
  const rows = await executor
    .select()
    .from(classSlots)
    .where(and(
      gte(classSlots.date, dayStart),
      lte(classSlots.date, dayEnd),
      eq(classSlots.classBand, absence.declaredClassBand),
      eq(classSlots.startTime, parsed.startTime),
    ))
    .limit(2);

  return resolveUniqueSlotCandidate(rows, absence.originalSlotId, `absence:${absence.id}`);
}

export async function analyzeDriftedSlotAliasCandidate(
  executor: Executor,
  slot: Pick<ClassSlot, "id">,
): Promise<AliasBackfillCandidate | null> {
  const resolved = await resolveSlotByAlias(executor, slot.id);
  if (resolved) {
    return null;
  }

  const rows = await executor
    .select({
      canonicalSlotId: slotIdAliases.canonicalSlotId,
    })
    .from(slotIdAliases)
    .where(eq(slotIdAliases.legacySlotId, slot.id))
    .limit(1);

  if (rows.length > 0) {
    return null;
  }

  return {
    status: "unresolved",
    legacySlotId: slot.id,
    source: "drifted_slot_without_target",
  };
}

export async function resolveRequestSlotReference(
  executor: Executor,
  request: Pick<Request, "toSlotId" | "toSlotStartDateTime" | "declaredClassBand">,
): Promise<ResolvedSlotReference | undefined> {
  const aliasResolved = await resolveSlotByAlias(executor, request.toSlotId);
  if (aliasResolved) {
    return aliasResolved;
  }

  const exactSlot = await getSlotByExactId(executor, request.toSlotId);
  if (exactSlot) {
    return buildResolvedSlotReference(executor, exactSlot);
  }

  if (!request.toSlotStartDateTime) {
    return undefined;
  }

  const rows = await executor
    .select()
    .from(classSlots)
    .where(and(
      eq(classSlots.lessonStartDateTime, request.toSlotStartDateTime),
      eq(classSlots.classBand, request.declaredClassBand),
    ))
    .limit(2);

  if (rows.length !== 1) {
    return undefined;
  }

  return buildResolvedSlotReference(executor, rows[0]);
}

export async function resolveAbsenceSlotReference(
  executor: Executor,
  absence: Pick<Absence, "originalSlotId" | "declaredClassBand" | "absentDate">,
): Promise<ResolvedSlotReference | undefined> {
  const aliasResolved = await resolveSlotByAlias(executor, absence.originalSlotId);
  if (aliasResolved) {
    return aliasResolved;
  }

  const exactSlot = await getSlotByExactId(executor, absence.originalSlotId);
  if (exactSlot) {
    return buildResolvedSlotReference(executor, exactSlot);
  }

  const parsed = parseSlotId(absence.originalSlotId);
  if (!parsed) {
    return undefined;
  }

  const dayStart = startOfJstDay(absence.absentDate);
  const dayEnd = endOfJstDay(absence.absentDate);
  const rows = await executor
    .select()
    .from(classSlots)
    .where(and(
      gte(classSlots.date, dayStart),
      lte(classSlots.date, dayEnd),
      eq(classSlots.classBand, absence.declaredClassBand),
      eq(classSlots.startTime, parsed.startTime),
    ))
    .limit(2);

  if (rows.length !== 1) {
    return undefined;
  }

  return buildResolvedSlotReference(executor, rows[0]);
}

export async function getAliasRowsByCanonicalSlotIds(
  executor: Executor,
  canonicalSlotIds: string[],
): Promise<Array<{ legacySlotId: string; canonicalSlotId: string; source: string }>> {
  if (canonicalSlotIds.length === 0) {
    return [];
  }

  return executor
    .select({
      legacySlotId: slotIdAliases.legacySlotId,
      canonicalSlotId: slotIdAliases.canonicalSlotId,
      source: slotIdAliases.source,
    })
    .from(slotIdAliases)
    .where(inArray(slotIdAliases.canonicalSlotId, canonicalSlotIds))
    .orderBy(asc(slotIdAliases.legacySlotId));
}

export async function getAliasRow(executor: Executor, legacySlotId: string) {
  return getAliasRowByLegacySlotId(executor, legacySlotId);
}
