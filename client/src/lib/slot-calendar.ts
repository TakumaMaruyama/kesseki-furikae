import type { SlotSearchResult } from "@shared/schema";

export const SLOT_STATUS_ORDER = ["〇", "△", "×"] as const;

export type SlotStatusCode = (typeof SLOT_STATUS_ORDER)[number];

export type SlotDateSummary = {
  dateKey: string;
  slots: SlotSearchResult[];
  statusCodes: SlotStatusCode[];
  statusCounts: Record<SlotStatusCode, number>;
  bookableCount: number;
};

function toUtcDay(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

export function buildSlotDateSummaries(slots: SlotSearchResult[]): Map<string, SlotDateSummary> {
  const summaries = new Map<string, SlotDateSummary>();

  for (const slot of slots) {
    const summary = summaries.get(slot.date) ?? {
      dateKey: slot.date,
      slots: [],
      statusCodes: [],
      statusCounts: { "〇": 0, "△": 0, "×": 0 },
      bookableCount: 0,
    };

    summary.slots.push(slot);
    summary.statusCounts[slot.statusCode] += 1;
    if (slot.statusCode !== "×") {
      summary.bookableCount += 1;
    }
    summaries.set(slot.date, summary);
  }

  for (const summary of Array.from(summaries.values())) {
    summary.statusCodes = SLOT_STATUS_ORDER.filter(
      (statusCode) => summary.statusCounts[statusCode] > 0,
    );
  }

  return summaries;
}

export function getDefaultSlotDate(
  summaries: Map<string, SlotDateSummary>,
  absentDateKey: string,
): string | undefined {
  const allSummaries = Array.from(summaries.values());
  const bookableSummaries = allSummaries.filter((summary) => summary.bookableCount > 0);
  const candidates = bookableSummaries.length > 0 ? bookableSummaries : allSummaries;
  const absentDay = toUtcDay(absentDateKey);

  return candidates
    .sort((a, b) => {
      const aDay = toUtcDay(a.dateKey);
      const bDay = toUtcDay(b.dateKey);
      const distanceDifference = Math.abs(aDay - absentDay) - Math.abs(bDay - absentDay);

      if (distanceDifference !== 0) {
        return distanceDifference;
      }

      const aIsOnOrAfter = aDay >= absentDay;
      const bIsOnOrAfter = bDay >= absentDay;
      if (aIsOnOrAfter !== bIsOnOrAfter) {
        return aIsOnOrAfter ? -1 : 1;
      }

      return aDay - bDay;
    })[0]?.dateKey;
}
