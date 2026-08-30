import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  toPublicLookupAbsence,
  toPublicLookupRequest,
} from "../server/publicLookup.ts";

const publicAbsence = toPublicLookupAbsence({
  id: "absence-1",
  childName: "テスト",
  declaredClassBand: "初級",
  reportType: "ABSENCE",
  absentDate: new Date("2026-09-01T00:00:00.000Z"),
  makeupDeadline: new Date("2026-10-01T00:00:00.000Z"),
  makeupStatus: "PENDING",
  resumeToken: "secret-resume-token",
  contactEmail: "private@example.com",
  reason: "private reason",
} as any);

assert.deepEqual(Object.keys(publicAbsence).sort(), [
  "absentDate",
  "childName",
  "declaredClassBand",
  "id",
  "makeupDeadline",
  "makeupStatus",
  "reportType",
]);

const publicRequest = toPublicLookupRequest({
  id: "request-1",
  childName: "テスト",
  declaredClassBand: "初級",
  toSlotId: "slot-1",
  toSlotStartDateTime: new Date("2026-09-02T00:00:00.000Z"),
  status: "確定",
  confirmToken: "secret-confirm-token",
  declineToken: "secret-decline-token",
  cancelToken: "secret-cancel-token",
  contactEmail: "private@example.com",
} as any);

assert.deepEqual(Object.keys(publicRequest).sort(), [
  "childName",
  "declaredClassBand",
  "id",
  "status",
  "toSlotId",
  "toSlotStartDateTime",
]);

const routesSource = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
assert.match(routesSource, /app\.get\("\/api\/lookup\/:confirmCode", lookupRateLimiter/);
assert.match(routesSource, /app\.post\("\/api\/booking-token", bookingTokenRateLimiter/);
assert.match(routesSource, /app\.post\("\/api\/admin\/book"[\s\S]*?requireAbsence: true/);
assert.match(routesSource, /app\.post\("\/api\/admin\/book-without-absence"[\s\S]*?requireAbsence: false/);

const statusSource = readFileSync(new URL("../client/src/pages/status.tsx", import.meta.url), "utf8");
assert.match(statusSource, /apiRequest\("POST", "\/api\/booking-token"/);
assert.doesNotMatch(statusSource, /absence\.resumeToken/);

console.log("verify-security-hardening: ok");
