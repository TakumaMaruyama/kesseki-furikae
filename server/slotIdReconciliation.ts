import type { ClassSlot } from "@shared/schema";
import { formatJstDate, parseJstDateTime } from "@shared/jst";
import { buildCanonicalSlotId } from "@shared/slotId";

export const SLOT_ID_REKEY_TARGET_EXISTS = "SLOT_ID_REKEY_TARGET_EXISTS";

export type SlotIdReconciliationDeps = {
  getClassSlotByExactId(id: string): Promise<ClassSlot | undefined>;
  rekeySlotId(args: {
    currentSlot: ClassSlot;
    targetSlotId: string;
    targetSlotStartDateTime: Date;
  }): Promise<void>;
};

export type SlotIdReconciliationResult = "unchanged" | "repaired" | "blocked";

export function resolveCanonicalSlotId(slot: Pick<ClassSlot, "date" | "startTime" | "classBand">): string {
  const dateISO = formatJstDate(slot.date);
  const classBand = slot.classBand as "初級" | "中級" | "上級";
  return buildCanonicalSlotId(dateISO, slot.startTime, classBand);
}

export function resolveCanonicalSlotStartDateTime(slot: Pick<ClassSlot, "date" | "startTime">): Date {
  return parseJstDateTime(formatJstDate(slot.date), slot.startTime);
}

export async function reconcileDriftedSlotIdConflict(
  deps: SlotIdReconciliationDeps,
  requestedSlotId: string,
): Promise<SlotIdReconciliationResult> {
  const currentSlot = await deps.getClassSlotByExactId(requestedSlotId);
  if (!currentSlot) {
    return "unchanged";
  }

  const targetSlotId = resolveCanonicalSlotId(currentSlot);
  if (targetSlotId === requestedSlotId) {
    return "unchanged";
  }

  const targetSlot = await deps.getClassSlotByExactId(targetSlotId);
  if (targetSlot) {
    return "blocked";
  }

  try {
    await deps.rekeySlotId({
      currentSlot,
      targetSlotId,
      targetSlotStartDateTime: resolveCanonicalSlotStartDateTime(currentSlot),
    });
  } catch (error: any) {
    if (error?.message === SLOT_ID_REKEY_TARGET_EXISTS) {
      return "blocked";
    }
    throw error;
  }

  return "repaired";
}
