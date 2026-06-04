import assert from "node:assert/strict";
import {
  getNewEnrolleeDisplayDates,
  isNewEnrolleeVisibleOnDate,
} from "../shared/newEnrolleeVisibility";
import { formatJstDate } from "../shared/jst";

function main() {
  const sameDayDisplayDates = getNewEnrolleeDisplayDates("2026-06-01", "月曜");
  assert.deepEqual(
    sameDayDisplayDates.map((date) => formatJstDate(date)),
    ["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22"],
  );

  const nextWeekdayDisplayDates = getNewEnrolleeDisplayDates("2026-06-02", "木曜");
  assert.deepEqual(
    nextWeekdayDisplayDates.map((date) => formatJstDate(date)),
    ["2026-06-04", "2026-06-11", "2026-06-18", "2026-06-25"],
  );

  assert.equal(
    isNewEnrolleeVisibleOnDate({
      joinedAt: "2026-06-02",
      targetDayOfWeek: "木曜",
      date: "2026-06-04",
    }),
    true,
  );

  assert.equal(
    isNewEnrolleeVisibleOnDate({
      joinedAt: "2026-06-02",
      targetDayOfWeek: "木曜",
      date: "2026-06-10",
    }),
    false,
  );

  assert.equal(
    isNewEnrolleeVisibleOnDate({
      joinedAt: "2026-06-02",
      targetDayOfWeek: "木曜",
      date: "2026-07-02",
    }),
    false,
  );

  console.log("verify-new-enrollees: ok");
}

try {
  main();
} catch (error) {
  console.error("verify-new-enrollees: failed");
  console.error(error);
  process.exitCode = 1;
}
