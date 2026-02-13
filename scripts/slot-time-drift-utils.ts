import type { ClassSlot } from "../shared/schema.ts";
import { formatJstDate, parseJstDate, parseJstDateTime } from "../shared/jst.ts";

const SLOT_ID_PATTERN = /^(\d{4}-\d{2}-\d{2})_(\d{2}:\d{2})(?::\d{2})?_/;
const DAY_MS = 24 * 60 * 60 * 1000;

type SlotIdInfo = {
  dateISO: string;
  timeHHMM: string;
};

export type SlotTimeDriftAnalysis = {
  slot: ClassSlot;
  canonicalFromColumns: Date;
  storedLessonStartDateTime: Date | null;
  lessonStartMatchesCanonical: boolean;
  columnDateISO: string;
  slotTimeHHMM: string;
  idDateISO: string | null;
  idTimeHHMM: string | null;
  idParsable: boolean;
  timeMatchesId: boolean;
  dayDiffFromId: number | null;
  hasOneDayIdDateDrift: boolean;
  fromId: Date | null;
};

function parseSlotId(slotId: string): SlotIdInfo | null {
  const match = SLOT_ID_PATTERN.exec(slotId);
  if (!match) return null;

  return {
    dateISO: match[1],
    timeHHMM: match[2],
  };
}

function normalizeToHHMM(time: string): string {
  return time.slice(0, 5);
}

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function analyzeSlotTimeDrift(slot: ClassSlot): SlotTimeDriftAnalysis {
  const columnDateISO = formatJstDate(slot.date);
  const slotTimeHHMM = normalizeToHHMM(slot.startTime);
  const canonicalFromColumns = parseJstDateTime(columnDateISO, slot.startTime);
  const storedLessonStartDateTime = toDateOrNull(slot.lessonStartDateTime);
  const lessonStartMatchesCanonical =
    !!storedLessonStartDateTime && storedLessonStartDateTime.getTime() === canonicalFromColumns.getTime();

  const idInfo = parseSlotId(slot.id);
  const idParsable = !!idInfo;
  const idDateISO = idInfo?.dateISO ?? null;
  const idTimeHHMM = idInfo?.timeHHMM ?? null;
  const timeMatchesId = !!idInfo && idInfo.timeHHMM === slotTimeHHMM;

  let dayDiffFromId: number | null = null;
  let fromId: Date | null = null;
  if (idInfo && timeMatchesId) {
    const idDate = parseJstDate(idInfo.dateISO);
    const columnDate = parseJstDate(columnDateISO);
    dayDiffFromId = Math.round((idDate.getTime() - columnDate.getTime()) / DAY_MS);
    fromId = parseJstDateTime(idInfo.dateISO, slot.startTime);
  }

  const hasOneDayIdDateDrift = dayDiffFromId !== null && Math.abs(dayDiffFromId) === 1;

  return {
    slot,
    canonicalFromColumns,
    storedLessonStartDateTime,
    lessonStartMatchesCanonical,
    columnDateISO,
    slotTimeHHMM,
    idDateISO,
    idTimeHHMM,
    idParsable,
    timeMatchesId,
    dayDiffFromId,
    hasOneDayIdDateDrift,
    fromId,
  };
}
