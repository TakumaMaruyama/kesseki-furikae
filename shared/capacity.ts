type Numeric = number | null | undefined;

export type SlotCapacityLike = {
  capacityLimit: Numeric;
  capacityCurrent: Numeric;
  capacityMakeupUsed: Numeric;
  trialParticipantCount?: Numeric;
};

function toSafeInt(value: Numeric): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return value;
}

export function getCapacityLimit(slot: SlotCapacityLike): number {
  return toSafeInt(slot.capacityLimit);
}

export function getBaseCurrent(slot: SlotCapacityLike): number {
  return Math.max(0, toSafeInt(slot.capacityCurrent));
}

export function getMakeupUsed(slot: SlotCapacityLike): number {
  return Math.max(0, toSafeInt(slot.capacityMakeupUsed));
}

export function getTrialParticipantCount(slot: SlotCapacityLike): number {
  return Math.max(0, toSafeInt(slot.trialParticipantCount));
}

export function getActualCurrent(slot: SlotCapacityLike): number {
  return getBaseCurrent(slot) + getMakeupUsed(slot) + getTrialParticipantCount(slot);
}

export function getMakeupCapacityLimit(slot: SlotCapacityLike): number {
  return Math.max(0, getCapacityLimit(slot) - getBaseCurrent(slot) - getTrialParticipantCount(slot));
}

export function getRemainingCapacity(slot: SlotCapacityLike): number {
  return Math.max(0, getCapacityLimit(slot) - getActualCurrent(slot));
}

export function hasRemainingCapacity(slot: SlotCapacityLike, required = 1): boolean {
  return getRemainingCapacity(slot) >= required;
}
