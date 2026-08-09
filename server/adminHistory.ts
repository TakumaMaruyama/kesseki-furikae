import { and, desc, gte, inArray, lt, or, type SQL } from "drizzle-orm";
import { absences, classSlots, requests, slotIdAliases, type ClassSlot } from "@shared/schema";
import { formatJstDate, getJstMonthRange } from "@shared/jst";
import { parseSlotId } from "@shared/slotId";
import { db } from "./db";

type HistorySlotLookup = {
  aliasByLegacyId: Map<string, string>;
  slotById: Map<string, ClassSlot>;
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function appendToLookup(
  lookup: Map<string, ClassSlot[]>,
  key: string,
  slot: ClassSlot,
): void {
  const existing = lookup.get(key);
  if (existing) {
    existing.push(slot);
    return;
  }
  lookup.set(key, [slot]);
}

async function loadHistorySlotLookup(
  rawSlotIds: string[],
  fallbackCondition: SQL | undefined,
): Promise<HistorySlotLookup> {
  const uniqueRawSlotIds = unique(rawSlotIds);
  if (uniqueRawSlotIds.length === 0) {
    return {
      aliasByLegacyId: new Map(),
      slotById: new Map(),
    };
  }

  const aliasRows = await db
    .select({
      legacySlotId: slotIdAliases.legacySlotId,
      canonicalSlotId: slotIdAliases.canonicalSlotId,
    })
    .from(slotIdAliases)
    .where(inArray(slotIdAliases.legacySlotId, uniqueRawSlotIds));

  const aliasByLegacyId = new Map(
    aliasRows.map((row) => [row.legacySlotId, row.canonicalSlotId]),
  );
  const directSlotIds = unique([
    ...uniqueRawSlotIds,
    ...aliasRows.map((row) => row.canonicalSlotId),
  ]);

  const slots = await db
    .select()
    .from(classSlots)
    .where(or(
      inArray(classSlots.id, directSlotIds),
      fallbackCondition,
    ));

  return {
    aliasByLegacyId,
    slotById: new Map(slots.map((slot) => [slot.id, slot])),
  };
}

function resolveDirectSlot(rawSlotId: string, lookup: HistorySlotLookup): ClassSlot | undefined {
  const canonicalSlotId = lookup.aliasByLegacyId.get(rawSlotId);
  if (canonicalSlotId) {
    const aliasedSlot = lookup.slotById.get(canonicalSlotId);
    if (aliasedSlot) {
      return aliasedSlot;
    }
  }

  return lookup.slotById.get(rawSlotId);
}

function absenceFallbackKey(date: Date, classBand: string, startTime: string): string {
  return `${formatJstDate(date)}|${classBand}|${startTime}`;
}

function requestFallbackKey(startDateTime: Date, classBand: string): string {
  return `${startDateTime.getTime()}|${classBand}`;
}

function uniqueFallbackSlot(slots: ClassSlot[] | undefined): ClassSlot | undefined {
  return slots?.length === 1 ? slots[0] : undefined;
}

export async function getAdminAbsenceHistory(month: string) {
  const { start, end } = getJstMonthRange(month);
  const history = await db
    .select()
    .from(absences)
    .where(and(
      gte(absences.absentDate, start),
      lt(absences.absentDate, end),
    ))
    .orderBy(desc(absences.absentDate), desc(absences.createdAt), desc(absences.id));

  if (history.length === 0) {
    return [];
  }

  const slotLookup = await loadHistorySlotLookup(
    history.map((absence) => absence.originalSlotId),
    and(
      gte(classSlots.date, start),
      lt(classSlots.date, end),
    ),
  );
  const fallbackSlots = new Map<string, ClassSlot[]>();

  for (const slot of Array.from(slotLookup.slotById.values())) {
    appendToLookup(
      fallbackSlots,
      absenceFallbackKey(slot.date, slot.classBand, slot.startTime),
      slot,
    );
  }

  return history.map((absence) => {
    let slot = resolveDirectSlot(absence.originalSlotId, slotLookup);
    if (!slot) {
      const parsedSlotId = parseSlotId(absence.originalSlotId);
      if (parsedSlotId) {
        slot = uniqueFallbackSlot(fallbackSlots.get(
          absenceFallbackKey(absence.absentDate, absence.declaredClassBand, parsedSlotId.startTime),
        ));
      }
    }

    return {
      ...absence,
      courseLabel: slot?.courseLabel ?? null,
      startTime: slot?.startTime ?? null,
    };
  });
}

export async function getAdminRequestHistory(month: string) {
  const { start, end } = getJstMonthRange(month);
  const history = await db
    .select()
    .from(requests)
    .where(and(
      gte(requests.toSlotStartDateTime, start),
      lt(requests.toSlotStartDateTime, end),
    ))
    .orderBy(desc(requests.toSlotStartDateTime), desc(requests.createdAt), desc(requests.id));

  if (history.length === 0) {
    return [];
  }

  const slotLookup = await loadHistorySlotLookup(
    history.map((request) => request.toSlotId),
    and(
      gte(classSlots.lessonStartDateTime, start),
      lt(classSlots.lessonStartDateTime, end),
    ),
  );
  const fallbackSlots = new Map<string, ClassSlot[]>();

  for (const slot of Array.from(slotLookup.slotById.values())) {
    appendToLookup(
      fallbackSlots,
      requestFallbackKey(slot.lessonStartDateTime, slot.classBand),
      slot,
    );
  }

  return history.map((request) => {
    const slot = resolveDirectSlot(request.toSlotId, slotLookup)
      ?? uniqueFallbackSlot(fallbackSlots.get(
        requestFallbackKey(request.toSlotStartDateTime, request.declaredClassBand),
      ));

    return {
      ...request,
      courseLabel: slot?.courseLabel ?? null,
      toSlotDate: slot ? formatJstDate(slot.date) : null,
      toSlotStartTime: slot?.startTime ?? null,
    };
  });
}
