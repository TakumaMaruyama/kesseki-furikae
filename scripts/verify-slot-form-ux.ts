import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  filterSelectableAbsenceSlots,
  getAutoSelectedAbsenceSlotId,
  isCurrentAbsenceSlotSelectionRequest,
} from "../client/src/lib/absence-slot-selection";

const root = resolve(import.meta.dirname, "..");
const read = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");

const parent = read("client/src/pages/parent.tsx");
const admin = read("client/src/pages/admin.tsx");
const slotDialog = read("client/src/components/admin/SlotDialog.tsx");
const sharedTypes = read("client/src/components/admin/types.ts");

// The original lesson slot must be presented as visible, keyboard-accessible radio cards.
assert.match(parent, /role="radiogroup"[\s\S]*data-testid=\{`original-slot-options-\$\{index\}`\}/);
assert.match(parent, /role="radio"[\s\S]*aria-checked=\{isSelected\}[\s\S]*onClick=\{\(\) => handleRowOriginalSlotChange\(index, slot\.id\)\}/);
assert.match(parent, /slot\.startTime[\s\S]*slot\.courseLabel/);

// Date/class changes clear the old choice, and only the latest request may auto-select one result.
assert.match(parent, /slotSelectionRequestRef\.current\[index\] = requestId/);
assert.match(parent, /setValue\(`items\.\$\{index\}\.originalSlotId` as const, ""/);
assert.match(parent, /slotSelectionRequestRef\.current\[index\] === requestId[\s\S]*validSlots\.length === 1|isCurrentAbsenceSlotSelectionRequest[\s\S]*getAutoSelectedAbsenceSlotId/);
assert.match(parent, /validSlots\[0\]\.id|getAutoSelectedAbsenceSlotId\(validSlots\)/);

const candidateSlots = [
  { id: "past", isPastLesson: true },
  { id: "current", isPastLesson: false },
];
assert.deepEqual(filterSelectableAbsenceSlots([], false), []);
assert.deepEqual(filterSelectableAbsenceSlots([{ id: "only" }], false), [{ id: "only" }]);
assert.deepEqual(filterSelectableAbsenceSlots(candidateSlots, false), [{ id: "current", isPastLesson: false }]);
assert.deepEqual(filterSelectableAbsenceSlots(candidateSlots, true), candidateSlots);
assert.equal(getAutoSelectedAbsenceSlotId([]), "");
assert.equal(getAutoSelectedAbsenceSlotId([{ id: "only" }]), "only");
assert.equal(getAutoSelectedAbsenceSlotId([{ id: "one" }, { id: "two" }]), "");

const currentRequest = {
  requestGeneration: 3,
  currentGeneration: 3,
  currentDate: "2026-09-01",
  expectedDate: "2026-09-01",
  currentClassBand: "初級",
  expectedClassBand: "初級",
};
assert.equal(isCurrentAbsenceSlotSelectionRequest(currentRequest), true);
assert.equal(isCurrentAbsenceSlotSelectionRequest({ ...currentRequest, requestGeneration: 2 }), false);
assert.equal(isCurrentAbsenceSlotSelectionRequest({ ...currentRequest, expectedDate: "2026-09-02" }), false);
assert.equal(isCurrentAbsenceSlotSelectionRequest({ ...currentRequest, currentClassBand: "中級" }), false);

// Calendar-mode creation receives the selected day; edits and list-mode creation do not.
assert.match(admin, /initialDate=\{[\s\S]*!editingSlotData[\s\S]*viewMode === "calendar"[\s\S]*selectedDate[\s\S]*formatJstDate\(selectedDate\)/);

// The dialog seeds new forms from initialDate, while edit dates are retained but not editable.
assert.match(slotDialog, /date: initialDate \?\? ""/);
assert.match(slotDialog, /<input \{\.\.\.field\} value=\{slotDateISO\} type="hidden"/);
assert.match(slotDialog, /data-testid="display-slot-date"/);
assert.match(slotDialog, /!slot[\s\S]*<Input \{\.\.\.field\} type="date" data-testid="input-slot-date"/);
assert.match(sharedTypes, /export type SlotDialogProps = \{[\s\S]*initialDate\?: string;/);

console.log("verify-slot-form-ux: ok");
