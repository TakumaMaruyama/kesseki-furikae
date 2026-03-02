export type ClassBand = "初級" | "中級" | "上級";

const CLASS_BAND_TO_SUFFIX: Record<ClassBand, string> = {
  "初級": "shokyu",
  "中級": "chukyu",
  "上級": "jokyu",
};

const SUFFIX_TO_CLASS_BAND: Record<string, ClassBand> = {
  shokyu: "初級",
  chukyu: "中級",
  jokyu: "上級",
};

const DATE_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}(?::\d{2})?$/;
const SLOT_ID_PATTERN = /^(\d{4}-\d{2}-\d{2})_(\d{2}:\d{2})(?::\d{2})?_([^_]+)$/;

function normalizeTimeToHHMM(time: string): string {
  if (!TIME_PATTERN.test(time)) {
    throw new Error(`Invalid slot time format: ${time}`);
  }
  return time.slice(0, 5);
}

export function getClassBandSuffix(classBand: ClassBand): string {
  const suffix = CLASS_BAND_TO_SUFFIX[classBand];
  if (!suffix) {
    throw new Error(`Unsupported class band: ${classBand}`);
  }
  return suffix;
}

export function buildCanonicalSlotId(dateISO: string, startTime: string, classBand: ClassBand): string {
  if (!DATE_ISO_PATTERN.test(dateISO)) {
    throw new Error(`Invalid slot date format: ${dateISO}`);
  }
  const hhmm = normalizeTimeToHHMM(startTime);
  return `${dateISO}_${hhmm}_${getClassBandSuffix(classBand)}`;
}

export type ParsedSlotId = {
  dateISO: string;
  startTime: string;
  classBandSuffix: string;
  classBand: ClassBand | null;
};

export function parseSlotId(slotId: string): ParsedSlotId | null {
  const match = SLOT_ID_PATTERN.exec(slotId);
  if (!match) {
    return null;
  }

  const classBandSuffix = match[3];
  return {
    dateISO: match[1],
    startTime: match[2],
    classBandSuffix,
    classBand: SUFFIX_TO_CLASS_BAND[classBandSuffix] || null,
  };
}
