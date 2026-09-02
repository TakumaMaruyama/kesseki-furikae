import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getNewEnrolleeDisplayDates,
  isNewEnrolleeVisibleOnDate,
} from "../shared/newEnrolleeVisibility";
import { formatJstDate } from "../shared/jst";
import {
  createNewEnrolleeRequestSchema,
  updateNewEnrolleeRequestSchema,
} from "../shared/schema";

function displayDates(joinedAt: string, targetDayOfWeek: string): string[] {
  return getNewEnrolleeDisplayDates(joinedAt, targetDayOfWeek)
    .map((date) => formatJstDate(date));
}

function main() {
  assert.deepEqual(
    displayDates("2026-06-01", "月曜"),
    ["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22"],
  );

  assert.deepEqual(
    displayDates("2026-06-02", "木曜"),
    ["2026-06-04", "2026-06-11", "2026-06-18", "2026-06-25"],
  );

  // Sunday joining dates and JST-midnight boundaries must resolve in JST, not the host timezone.
  assert.deepEqual(
    displayDates("2026-06-07T00:30:00+09:00", "土曜"),
    ["2026-06-13", "2026-06-20", "2026-06-27", "2026-07-04"],
  );
  assert.deepEqual(
    displayDates("2026-06-07T00:30:00+09:00", "日曜"),
    ["2026-06-07", "2026-06-14", "2026-06-21", "2026-06-28"],
  );

  const visibilityArgs = {
    joinedAt: "2026-06-02",
    targetDayOfWeek: "木曜",
  };
  assert.equal(isNewEnrolleeVisibleOnDate({ ...visibilityArgs, date: "2026-06-04" }), true);
  assert.equal(isNewEnrolleeVisibleOnDate({ ...visibilityArgs, date: "2026-06-25" }), true);
  assert.equal(isNewEnrolleeVisibleOnDate({ ...visibilityArgs, date: "2026-07-02" }), false);
  assert.equal(isNewEnrolleeVisibleOnDate({ ...visibilityArgs, date: "2026-06-10" }), false);

  assert.equal(createNewEnrolleeRequestSchema.safeParse({
    childName: "新規 太郎",
    joinedAtISO: "2026-06-02",
    courseId: "course-1",
  }).success, true);
  assert.equal(createNewEnrolleeRequestSchema.safeParse({
    childName: "新規 太郎",
    joinedAtISO: "2026-02-30",
    courseId: "course-1",
  }).success, false);
  assert.equal(updateNewEnrolleeRequestSchema.safeParse({}).success, false);

  const routesSource = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
  assert.match(routesSource, /app\.get\("\/api\/admin\/daily-status", requireAdmin/);
  assert.match(routesSource, /getDailyStatusForDate\(targetDate, \{ includeNewEnrollees: true \}\)/);
  assert.match(routesSource, /app\.get\("\/api\/admin\/trial-participants\/search", requireAdmin/);
  assert.match(routesSource, /app\.post\("\/api\/admin\/new-enrollees", requireAdmin/);
  assert.match(routesSource, /app\.put\("\/api\/admin\/new-enrollees\/:id", requireAdmin/);
  assert.match(routesSource, /app\.delete\("\/api\/admin\/new-enrollees\/:id", requireAdmin/);

  const adminViewSource = readFileSync(
    new URL("../client/src/components/admin/DailyStatusView.tsx", import.meta.url),
    "utf8",
  );
  assert.match(adminViewSource, /新規入会者を追加/);
  assert.match(adminViewSource, /登録コースの曜日に、入会日以降4回分を自動表示します/);

  console.log("verify-new-enrollees: ok");
}

try {
  main();
} catch (error) {
  console.error("verify-new-enrollees: failed");
  console.error(error);
  process.exitCode = 1;
}
