export const JST_TIME_ZONE = "Asia/Tokyo";

const DAY_MS = 24 * 60 * 60 * 1000;

const jstDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: JST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const jstWeekdayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: JST_TIME_ZONE,
  weekday: "short",
});

const weekdayMap: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function toDate(input: Date | string | number): Date {
  if (input instanceof Date) {
    return input;
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date value: ${String(input)}`);
  }
  return parsed;
}

function normalizeTime(time: string): string {
  if (/^\d{2}:\d{2}$/.test(time)) {
    return `${time}:00`;
  }
  if (/^\d{2}:\d{2}:\d{2}$/.test(time)) {
    return time;
  }
  throw new Error(`Invalid time format: ${time}`);
}

function parseDateParts(dateISO: string): [string, string, string] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!match) {
    throw new Error(`Invalid date format: ${dateISO}`);
  }
  return [match[1], match[2], match[3]];
}

export function parseJstDate(dateISO: string): Date {
  const [year, month, day] = parseDateParts(dateISO);
  return new Date(`${year}-${month}-${day}T00:00:00+09:00`);
}

export function parseJstDateTime(dateISO: string, time: string): Date {
  const [year, month, day] = parseDateParts(dateISO);
  const normalizedTime = normalizeTime(time);
  return new Date(`${year}-${month}-${day}T${normalizedTime}+09:00`);
}

export function formatJstDate(input: Date | string | number): string {
  const date = toDate(input);
  const parts = jstDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Could not format date in JST");
  }

  return `${year}-${month}-${day}`;
}

export function startOfJstDay(input: Date | string | number): Date {
  return parseJstDate(formatJstDate(input));
}

export function endOfJstDay(input: Date | string | number): Date {
  const start = startOfJstDay(input);
  return new Date(start.getTime() + DAY_MS - 1);
}

export function addJstDays(input: Date | string | number, days: number): Date {
  const start = startOfJstDay(input);
  return new Date(start.getTime() + (days * DAY_MS));
}

export function isSameJstDate(a: Date | string | number, b: Date | string | number): boolean {
  return formatJstDate(a) === formatJstDate(b);
}

export function getJstDayOfWeek(input: Date | string | number): number {
  const date = toDate(input);
  const weekday = jstWeekdayFormatter.format(date);
  const day = weekdayMap[weekday];
  if (day === undefined) {
    throw new Error(`Could not resolve JST weekday: ${weekday}`);
  }
  return day;
}
