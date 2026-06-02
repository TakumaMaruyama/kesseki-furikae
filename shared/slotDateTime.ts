import { endOfJstDay, formatJstDate, parseJstDateTime } from "./jst";
import { parseSlotId } from "./slotId";

type SlotLike = {
  date: Date | string | number;
  startTime: string;
};

type RequestLike = {
  toSlotId: string;
  toSlotStartDateTime?: Date | string | null;
};

function toValidDate(value: Date | string): Date | null {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getSlotDateISO(slot: SlotLike): string {
  return formatJstDate(slot.date);
}

export function getCanonicalSlotStartDateTime(slot: SlotLike): Date {
  return parseJstDateTime(getSlotDateISO(slot), slot.startTime);
}

export function isSlotStarted(slot: SlotLike, now: Date = new Date()): boolean {
  return getCanonicalSlotStartDateTime(slot).getTime() <= now.getTime();
}

export function isDeadlineExpired(deadline: Date | string | number, now: Date = new Date()): boolean {
  return endOfJstDay(deadline).getTime() < now.getTime();
}

export function getRequestSlotDateTime(request: RequestLike): Date | null {
  if (request.toSlotStartDateTime) {
    const stored = toValidDate(request.toSlotStartDateTime);
    if (stored) {
      return stored;
    }
  }

  const parsed = parseSlotId(request.toSlotId);
  if (!parsed) {
    return null;
  }

  return parseJstDateTime(parsed.dateISO, parsed.startTime);
}
