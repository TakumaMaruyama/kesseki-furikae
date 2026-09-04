import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routesSource = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
assert.match(routesSource, /reason: absence\.reason,/);
assert.match(
  routesSource,
  /dailyStatus\.absentees\.map\(\(\{ childName, classBand, startTime, reportType, reason \}\)/,
);

const coachSource = readFileSync(new URL("../client/src/pages/coach.tsx", import.meta.url), "utf8");
assert.match(coachSource, /reason: item\.reason,/);
assert.match(coachSource, /<ExpandableReason reason=\{item\.reason\} \/>/);

const adminSource = readFileSync(
  new URL("../client/src/components/admin/DailyStatusView.tsx", import.meta.url),
  "utf8",
);
assert.match(adminSource, /<ExpandableReason reason=\{item\.reason\} \/>/);

const expandableReasonSource = readFileSync(
  new URL("../client/src/components/ExpandableReason.tsx", import.meta.url),
  "utf8",
);
assert.match(expandableReasonSource, /line-clamp-2/);
assert.match(expandableReasonSource, /scrollHeight > element\.clientHeight/);
assert.match(expandableReasonSource, /もっと見る/);
assert.match(expandableReasonSource, /折りたたむ/);
assert.match(expandableReasonSource, /aria-expanded=\{isExpanded\}/);

console.log("verify-daily-status-reasons: ok");
