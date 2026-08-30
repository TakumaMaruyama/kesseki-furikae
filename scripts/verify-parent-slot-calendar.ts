import assert from "node:assert/strict";
import type { SlotSearchResult } from "../shared/schema";
import {
  buildSlotDateSummaries,
  getDefaultSlotDate,
} from "../client/src/lib/slot-calendar";

let slotSequence = 0;

function slot(date: string, statusCode: SlotSearchResult["statusCode"]): SlotSearchResult {
  slotSequence += 1;
  return {
    slotId: `${date}-${statusCode}-${slotSequence}`,
    date,
    startTime: "10:00",
    courseLabel: "テスト",
    classBand: "初級",
    statusCode,
    statusText: "テスト",
    remainingSlots: statusCode === "〇" ? 2 : statusCode === "△" ? 1 : 0,
  };
}

const mixed = buildSlotDateSummaries([
  slot("2026-09-01", "×"),
  slot("2026-09-01", "〇"),
  slot("2026-09-01", "〇"),
  slot("2026-09-01", "△"),
]);
assert.deepEqual(mixed.get("2026-09-01")?.statusCodes, ["〇", "△", "×"]);
assert.deepEqual(mixed.get("2026-09-01")?.statusCounts, { "〇": 2, "△": 1, "×": 1 });
assert.equal(mixed.get("2026-09-01")?.bookableCount, 3);

const nearestBookable = buildSlotDateSummaries([
  slot("2026-08-29", "△"),
  slot("2026-08-30", "×"),
  slot("2026-08-31", "〇"),
]);
assert.equal(getDefaultSlotDate(nearestBookable, "2026-08-30"), "2026-08-31");

const allFull = buildSlotDateSummaries([
  slot("2026-08-28", "×"),
  slot("2026-09-01", "×"),
]);
assert.equal(getDefaultSlotDate(allFull, "2026-08-30"), "2026-09-01");
assert.equal(getDefaultSlotDate(new Map(), "2026-08-30"), undefined);

console.log("Parent slot calendar verification passed.");
