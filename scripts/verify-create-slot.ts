import assert from "node:assert/strict";
import { createClassSlots, type CreateSlotInput, type SlotCreationDeps } from "../server/slotCreation";
import {
  reconcileDriftedSlotIdConflict,
  resolveCanonicalSlotStartDateTime,
  type SlotIdReconciliationDeps,
} from "../server/slotIdReconciliation";
import type { ClassSlot, InsertClassSlot } from "../shared/schema";
import { buildCanonicalSlotId } from "../shared/slotId";

function createMemoryDeps(initialSlots: ClassSlot[] = []): SlotCreationDeps & SlotIdReconciliationDeps {
  const slots = new Map(initialSlots.map((slot) => [slot.id, slot]));

  return {
    async getClassSlotByExactId(id: string) {
      return slots.get(id);
    },
    async createClassSlot(data: InsertClassSlot) {
      const slot: ClassSlot = {
        ...data,
        isClosed: false,
        createdAt: new Date("2026-06-02T00:00:00.000Z"),
        updatedAt: new Date("2026-06-02T00:00:00.000Z"),
      };
      slots.set(slot.id, slot);
      return slot;
    },
    async rekeySlotId({ currentSlot, targetSlotId, targetSlotStartDateTime }) {
      slots.delete(currentSlot.id);
      slots.set(targetSlotId, {
        ...currentSlot,
        id: targetSlotId,
        lessonStartDateTime: targetSlotStartDateTime,
        updatedAt: new Date("2026-06-02T00:00:00.000Z"),
      });
    },
  };
}

function buildInput(overrides: Partial<CreateSlotInput> = {}): CreateSlotInput {
  return {
    date: "2026-06-09",
    startTime: "10:00",
    courseLabel: "火曜10時コース",
    classBands: ["初級"],
    classBandCapacities: {
      初級: {
        capacityLimit: 10,
        capacityCurrent: 0,
      },
    },
    ...overrides,
  };
}

function buildExistingSlot(id: string): ClassSlot {
  return {
    id,
    date: new Date("2026-06-09T00:00:00.000Z"),
    startTime: "10:00",
    courseLabel: "火曜10時コース",
    classBand: "初級",
    isClosed: false,
    capacityLimit: 10,
    capacityCurrent: 0,
    capacityMakeupUsed: 0,
    waitlistCount: 0,
    lessonStartDateTime: new Date("2026-06-09T01:00:00.000Z"),
    lastNotifiedRequestId: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
  };
}

async function main() {
  const existingId = buildCanonicalSlotId("2026-06-09", "10:00", "初級");

  const duplicateOnly = await createClassSlots(
    createMemoryDeps([buildExistingSlot(existingId)]),
    buildInput(),
  );
  assert.equal(duplicateOnly.createdSlots.length, 0);
  assert.equal(duplicateOnly.skippedCount, 1);

  const recreateAfterDelete = await createClassSlots(
    createMemoryDeps(),
    buildInput(),
  );
  assert.equal(recreateAfterDelete.createdSlots.length, 1);
  assert.equal(recreateAfterDelete.skippedCount, 0);
  assert.equal(recreateAfterDelete.createdSlots[0]?.id, existingId);

  const partialRecurring = await createClassSlots(
    createMemoryDeps([buildExistingSlot(existingId)]),
    buildInput({
      isRecurring: true,
      recurringWeeks: 2,
    }),
  );
  assert.equal(partialRecurring.createdSlots.length, 1);
  assert.equal(partialRecurring.skippedCount, 1);
  assert.equal(
    partialRecurring.createdSlots[0]?.id,
    buildCanonicalSlotId("2026-06-16", "10:00", "初級"),
  );

  const driftedTargetId = buildCanonicalSlotId("2026-06-23", "10:00", "初級");
  const driftedSlot = buildExistingSlot(driftedTargetId);
  driftedSlot.date = new Date("2026-06-30T00:00:00.000Z");
  driftedSlot.lessonStartDateTime = resolveCanonicalSlotStartDateTime(driftedSlot);

  const driftedDeps = createMemoryDeps([driftedSlot]);
  const repaired = await reconcileDriftedSlotIdConflict(driftedDeps, driftedTargetId);
  assert.equal(repaired, "repaired");
  assert.equal(await driftedDeps.getClassSlotByExactId(driftedTargetId), undefined);
  assert.ok(await driftedDeps.getClassSlotByExactId(buildCanonicalSlotId("2026-06-30", "10:00", "初級")));

  const createdAfterRepair = await createClassSlots(driftedDeps, buildInput({
    date: "2026-06-23",
  }));
  assert.equal(createdAfterRepair.createdSlots.length, 1);
  assert.equal(createdAfterRepair.skippedCount, 0);
  assert.equal(createdAfterRepair.createdSlots[0]?.id, driftedTargetId);

  console.log("verify-create-slot: ok");
}

main().catch((error) => {
  console.error("verify-create-slot: failed");
  console.error(error);
  process.exitCode = 1;
});
