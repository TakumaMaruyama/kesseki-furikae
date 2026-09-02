import { addJstDays, getJstDayOfWeek, isSameJstDate, startOfJstDay } from "./jst";

export const NEW_ENROLLEE_DISPLAY_OCCURRENCES = 4;
export const DAY_OF_WEEK_LABELS = ["日曜", "月曜", "火曜", "水曜", "木曜", "金曜", "土曜"] as const;

export type DayOfWeekLabel = typeof DAY_OF_WEEK_LABELS[number];

const dayOfWeekIndexByLabel = DAY_OF_WEEK_LABELS.reduce<Record<DayOfWeekLabel, number>>((acc, label, index) => {
  acc[label] = index;
  return acc;
}, {} as Record<DayOfWeekLabel, number>);

function getDayOfWeekIndex(label: string): number {
  if (label in dayOfWeekIndexByLabel) {
    return dayOfWeekIndexByLabel[label as DayOfWeekLabel];
  }
  throw new Error(`Unsupported day of week label: ${label}`);
}

export function getDayOfWeekLabelForDate(input: Date | string | number): DayOfWeekLabel {
  return DAY_OF_WEEK_LABELS[getJstDayOfWeek(input)];
}

/** Returns the first scheduled lesson on or after the JST joining date. */
export function resolveFirstNewEnrolleeDisplayDate(
  joinedAt: Date | string | number,
  targetDayOfWeek: string,
): Date {
  const joinedAtDay = startOfJstDay(joinedAt);
  const dayOffset = (getDayOfWeekIndex(targetDayOfWeek) - getJstDayOfWeek(joinedAtDay) + 7) % 7;
  return addJstDays(joinedAtDay, dayOffset);
}

export function getNewEnrolleeDisplayDates(
  joinedAt: Date | string | number,
  targetDayOfWeek: string,
): Date[] {
  const firstDisplayDate = resolveFirstNewEnrolleeDisplayDate(joinedAt, targetDayOfWeek);
  return Array.from({ length: NEW_ENROLLEE_DISPLAY_OCCURRENCES }, (_, index) =>
    addJstDays(firstDisplayDate, index * 7),
  );
}

export function isNewEnrolleeVisibleOnDate(args: {
  joinedAt: Date | string | number;
  targetDayOfWeek: string;
  date: Date | string | number;
}): boolean {
  return getNewEnrolleeDisplayDates(args.joinedAt, args.targetDayOfWeek)
    .some((displayDate) => isSameJstDate(displayDate, args.date));
}
