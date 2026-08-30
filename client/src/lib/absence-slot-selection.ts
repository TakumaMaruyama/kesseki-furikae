export type AbsenceSlotSelectionCandidate = {
  id: string;
  isPastLesson?: boolean;
};

export function filterSelectableAbsenceSlots<T extends AbsenceSlotSelectionCandidate>(
  slots: readonly T[],
  isClosureMode: boolean,
): T[] {
  return isClosureMode ? [...slots] : slots.filter((slot) => !slot.isPastLesson);
}

export function getAutoSelectedAbsenceSlotId(
  slots: readonly AbsenceSlotSelectionCandidate[],
): string {
  return slots.length === 1 ? slots[0].id : "";
}

export function isCurrentAbsenceSlotSelectionRequest({
  requestGeneration,
  currentGeneration,
  currentDate,
  expectedDate,
  currentClassBand,
  expectedClassBand,
}: {
  requestGeneration: number;
  currentGeneration: number;
  currentDate?: string;
  expectedDate?: string;
  currentClassBand?: string;
  expectedClassBand?: string;
}): boolean {
  return (
    requestGeneration === currentGeneration &&
    currentDate === expectedDate &&
    currentClassBand === expectedClassBand
  );
}
