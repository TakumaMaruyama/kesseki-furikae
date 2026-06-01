import { addDays } from "date-fns";
import { formatJstDate, parseJstDate, parseJstDateTime } from "@shared/jst";
import type { ClassSlot, InsertClassSlot } from "@shared/schema";
import { buildCanonicalSlotId, type ClassBand } from "@shared/slotId";

export type SlotBandCapacity = {
  capacityLimit: number;
  capacityCurrent: number;
};

export type CreateSlotInput = {
  date: string;
  startTime: string;
  courseLabel: string;
  classBands: ClassBand[];
  classBandCapacities: Record<string, SlotBandCapacity>;
  isRecurring?: boolean;
  recurringWeeks?: number;
};

export type SlotCreationDeps = {
  getClassSlotById(id: string): Promise<ClassSlot | undefined>;
  createClassSlot(data: InsertClassSlot): Promise<ClassSlot>;
};

export type CreateSlotsResult = {
  createdSlots: ClassSlot[];
  skippedCount: number;
};

export async function createClassSlots(
  deps: SlotCreationDeps,
  data: CreateSlotInput,
): Promise<CreateSlotsResult> {
  const createdSlots: ClassSlot[] = [];
  let skippedCount = 0;

  const createSlotIfMissing = async (
    currentDate: Date,
    dateStr: string,
    classBand: ClassBand,
  ) => {
    const dateTime = parseJstDateTime(dateStr, data.startTime);
    const slotId = buildCanonicalSlotId(dateStr, data.startTime, classBand);

    const existing = await deps.getClassSlotById(slotId);
    if (existing) {
      skippedCount++;
      return;
    }

    const bandCapacity = data.classBandCapacities[classBand] || {
      capacityLimit: 10,
      capacityCurrent: 0,
    };

    const slot = await deps.createClassSlot({
      id: slotId,
      date: currentDate,
      startTime: data.startTime,
      courseLabel: data.courseLabel,
      classBand,
      capacityLimit: bandCapacity.capacityLimit,
      capacityCurrent: bandCapacity.capacityCurrent,
      capacityMakeupUsed: 0,
      waitlistCount: 0,
      lessonStartDateTime: dateTime,
      lastNotifiedRequestId: null,
    });

    createdSlots.push(slot);
  };

  if (data.isRecurring && data.recurringWeeks) {
    const startDate = parseJstDate(data.date);

    for (let week = 0; week < data.recurringWeeks; week++) {
      const currentDate = addDays(startDate, week * 7);
      const dateStr = formatJstDate(currentDate);

      for (const classBand of data.classBands) {
        await createSlotIfMissing(currentDate, dateStr, classBand);
      }
    }
  } else {
    const slotDate = parseJstDate(data.date);
    const dateStr = formatJstDate(slotDate);

    for (const classBand of data.classBands) {
      await createSlotIfMissing(slotDate, dateStr, classBand);
    }
  }

  return {
    createdSlots,
    skippedCount,
  };
}
