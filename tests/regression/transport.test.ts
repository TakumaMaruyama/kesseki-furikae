import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { CHILD_A, CHILD_B, PASSWORD, createSchoolFixture, type SchoolFixture } from "./fixture";
import { attendanceSnapshot, noticeInput, transportSetup } from "./transport-helpers";
import { formatJstDate, getJstDayOfWeek, parseJstDate, parseJstDateTime } from "../../shared/jst";
import { transportDateSchema } from "../../shared/transport";

let school: SchoolFixture;
before(async () => { school = await createSchoolFixture(); }, { timeout: 60_000 });
beforeEach(async () => school.reset());
after(async () => school?.dispose());
const noticesUrl = "/api/transport/notices";
const dayUrl = (id: string, date = school.dates.original) => `/api/transport/day?profileId=${id}&serviceDate=${date}`;

test("transport lifecycle: all directions, staff acknowledgement, correction and cancellation preserve attendance", async () => {
  const { admin, create, enter } = await transportSetup(school);
  const { profile, code } = await create();
  const cookie = await enter(code);
  const before = await attendanceSnapshot(school);
  let version = 0, saved: any;
  for (const direction of ["OUTBOUND", "INBOUND", "BOTH"]) {
    const result = await school.api(noticesUrl, noticeInput(profile.id, school.dates.original, { direction, expectedVersion: version }), cookie);
    assert.equal(result.status, 200);
    saved = result.body; version++;
    assert.equal(saved.version, version);
    assert.equal(saved.acknowledgedVersion, null);
    assert.equal((await school.api(`/api/admin/transport/notices/${saved.id}/acknowledge`, { version }, admin)).status, 200);
    assert.equal((await school.api(dayUrl(profile.id), undefined, cookie)).body.notice.acknowledgedVersion, version);
  }
  const cancelled = await school.api(noticesUrl, noticeInput(profile.id, school.dates.original, { direction: "BOTH", expectedVersion: version, status: "CANCELLED" }), cookie);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.version, 4);
  assert.equal(cancelled.body.acknowledgedVersion, null);
  const staff = await school.api(`/api/admin/transport/notices?date=${school.dates.original}`, undefined, admin);
  assert.equal(staff.body[0].status, "CANCELLED");
  assert.equal(staff.body[0].childName, CHILD_A);
  assert.equal(staff.body[0].serviceDate, school.dates.original);
  assert.deepEqual(await attendanceSnapshot(school), before);
  assert.deepEqual(await school.deliveries(), []);
});

test("transport duplicate submissions and retries create one notice; stale edits and acknowledgements cannot overwrite", async () => {
  const { admin, create, enter } = await transportSetup(school);
  const { profile, code } = await create(); const cookie = await enter(code);
  const input = noticeInput(profile.id, school.dates.original);
  const results = await Promise.all([school.api(noticesUrl, input, cookie), school.api(noticesUrl, input, cookie)]);
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  assert.equal(results[0].body.id, results[1].body.id);
  assert.deepEqual(results.map((r) => r.body.version), [1, 1]);
  const edits = await Promise.all(["INBOUND", "BOTH"].map((direction) => school.api(noticesUrl, { ...input, direction, expectedVersion: 1 }, cookie)));
  assert.deepEqual(edits.map((r) => r.status).sort(), [200, 409]);
  const saved = edits.find((r) => r.status === 200)!.body;
  assert.equal((await school.api(`/api/admin/transport/notices/${saved.id}/acknowledge`, { version: 1 }, admin)).status, 409);
  assert.equal((await school.api(noticesUrl, input, cookie)).status, 409);
  const current = (await school.api(dayUrl(profile.id), undefined, cookie)).body.notice;
  assert.equal(current.version, 2); assert.equal(current.acknowledgedVersion, null);
  const cancel = { ...input, direction: current.direction, expectedVersion: 2, status: "CANCELLED" };
  const cancellations = await Promise.all([school.api(noticesUrl, cancel, cookie), school.api(noticesUrl, cancel, cookie)]);
  assert.deepEqual(cancellations.map((r) => r.body.version), [3, 3]);
  assert.equal((await school.pool.query("SELECT count(*) FROM transport_notices")).rows[0].count, "1");
});

test("transport codes isolate children, allow explicit sibling switching and revoke old sessions when rotated", async () => {
  const { admin, create, enter } = await transportSetup(school);
  const a = await create(), b = await create(CHILD_B);
  const cookieA = await enter(a.code), cookieB = await enter(b.code);
  await school.api(noticesUrl, noticeInput(b.profile.id, school.dates.original), cookieB);
  assert.equal((await school.api(dayUrl(b.profile.id), undefined, cookieA)).status, 403);
  assert.equal((await school.api(noticesUrl, noticeInput(b.profile.id, school.dates.original, { status: "CANCELLED", expectedVersion: 1 }), cookieA)).status, 403);
  assert.equal((await school.api(noticesUrl, noticeInput(b.profile.id, school.dates.original, { direction: "BOTH", expectedVersion: 1 }), cookieA)).status, 403);
  assert.equal((await school.api(dayUrl(b.profile.id), undefined, cookieB)).body.notice.status, "ACTIVE");
  const siblings = await enter(b.code, cookieA);
  assert.equal((await school.api("/api/transport/session", undefined, siblings)).body.profiles.length, 2);
  const rotated = await school.api(`/api/admin/transport/profiles/${a.profile.id}/rotate-code`, {}, admin);
  assert.equal(rotated.status, 200);
  assert.equal((await school.api(dayUrl(a.profile.id), undefined, siblings)).status, 403);
  assert.equal((await school.api("/api/transport/access", { code: a.code })).status, 403);
  assert.equal((await school.api(dayUrl(a.profile.id), undefined, await enter(rotated.body.code))).status, 200);
});

test("transport sessions expire and staff-only operations reject parents, coaches and anonymous requests", async () => {
  const { create, enter } = await transportSetup(school); const a = await create(); const cookie = await enter(a.code);
  const coach = await school.api("/api/admin/login", { loginId: "synthetic-coach", password: PASSWORD });
  for (const session of [undefined, cookie, coach.cookie!]) {
    assert.equal((await school.api(`/api/admin/transport/notices?date=${school.dates.original}`, undefined, session)).status, 401);
    assert.equal((await school.api("/api/admin/transport/profiles", {}, session)).status, 401);
  }
  for (const session of [undefined, cookie]) assert.equal((await school.api(`/api/staff/transport/notices?date=${school.dates.original}`, undefined, session)).status, 401);
  assert.equal((await school.api(`/api/staff/transport/notices?date=${school.dates.original}`, undefined, coach.cookie!)).status, 200);
  const saved = await school.api(noticesUrl, noticeInput(a.profile.id, school.dates.original), cookie);
  assert.equal((await school.api(`/api/admin/transport/notices/${saved.body.id}/acknowledge`, { version: 1 }, coach.cookie!)).status, 401);
  assert.equal((await school.api(`/api/admin/transport/profiles/${a.profile.id}/stop`, {}, coach.cookie!)).status, 401);
  assert.equal((await school.api(`/api/admin/transport/profiles/${a.profile.id}/rotate-code`, {}, coach.cookie!)).status, 401);
  assert.equal((await school.api(dayUrl(a.profile.id))).status, 401);
  await school.pool.query("UPDATE admin_sessions SET sess=jsonb_set(sess::jsonb,'{transportUntil}','0')::json WHERE sess::jsonb ? 'transportUntil'");
  assert.equal((await school.api(dayUrl(a.profile.id), undefined, cookie)).status, 401);
  assert.equal((await school.api(noticesUrl, noticeInput(a.profile.id, school.dates.original), cookie)).status, 401);
  assert.deepEqual((await school.api("/api/transport/session", undefined, cookie)).body.profiles, []);
});

test("transport only allows registered legs and active transport children on a scheduled lesson", async () => {
  const { create, enter } = await transportSetup(school); const a = await create(CHILD_A, { inbound: false }); const cookie = await enter(a.code);
  for (const direction of ["INBOUND", "BOTH"]) assert.equal((await school.api(noticesUrl, noticeInput(a.profile.id, school.dates.original, { direction }), cookie)).status, 400);
  assert.equal((await school.api(noticesUrl, noticeInput(a.profile.id, school.dates.later), cookie)).status, 400);
  await school.pool.query("UPDATE class_slots SET is_closed=true WHERE id=$1", [school.ids.original]);
  assert.equal((await school.api(noticesUrl, noticeInput(a.profile.id, school.dates.original), cookie)).status, 400);
  await school.pool.query("UPDATE class_slots SET is_closed=false WHERE id=$1", [school.ids.original]);
  await school.pool.query("UPDATE transport_profiles SET active=false WHERE id=$1", [a.profile.id]);
  assert.equal((await school.api(noticesUrl, noticeInput(a.profile.id, school.dates.original), cookie)).status, 403);
  assert.equal((await school.api(noticesUrl, noticeInput("non-transport-child", school.dates.original), cookie)).status, 403);
});

test("transport absence and makeup dates are checked without modifying booking state", async () => {
  const { create, enter } = await transportSetup(school); const a = await create(); const cookie = await enter(a.code);
  const absent = await school.absence();
  assert.equal((await school.api(noticesUrl, noticeInput(a.profile.id, school.dates.original), cookie)).status, 400);
  assert.equal((await school.api("/api/book", school.booking(absent.absenceId))).status, 200);
  const before = await attendanceSnapshot(school);
  const day = await school.api(dayUrl(a.profile.id, school.dates.makeup), undefined, cookie);
  assert.equal(day.body.eligible, false); assert.match(day.body.reason, /振替日/);
  assert.equal((await school.api(noticesUrl, noticeInput(a.profile.id, school.dates.makeup), cookie)).status, 400);
  assert.deepEqual(await attendanceSnapshot(school), before);
});

test("transport attendance changes after submission are flagged; cancellation remains possible", async () => {
  const { admin, create, enter } = await transportSetup(school); const a = await create(); const cookie = await enter(a.code);
  const input = noticeInput(a.profile.id, school.dates.original);
  assert.equal((await school.api(noticesUrl, input, cookie)).status, 200);
  await school.absence();
  const rows = await school.api(`/api/admin/transport/notices?date=${school.dates.original}`, undefined, admin);
  assert.match(rows.body[0].attendanceWarning, /欠席/);
  const before = await attendanceSnapshot(school);
  assert.equal((await school.api(noticesUrl, { ...input, direction: "BOTH", expectedVersion: 1 }, cookie)).status, 400);
  assert.equal((await school.api(noticesUrl, { ...input, status: "CANCELLED", expectedVersion: 1 }, cookie)).status, 200);
  assert.deepEqual(await attendanceSnapshot(school), before);
});

test("transport ambiguous names do not infer attendance; late notifications do not become absences", async () => {
  const { create, enter } = await transportSetup(school); const a = await create(); const cookie = await enter(a.code);
  await school.absence(CHILD_A, { reportType: "LATE" });
  assert.equal((await school.api(dayUrl(a.profile.id), undefined, cookie)).body.eligible, true);
  await create(CHILD_A.replace(" ", "　"));
  const day = await school.api(dayUrl(a.profile.id), undefined, cookie);
  assert.equal(day.body.eligible, false); assert.match(day.body.reason, /同名/);
});

test("transport dates are strict Japanese civil dates and past dates are read-only", async () => {
  assert.equal(formatJstDate("2026-10-01T14:59:59Z"), "2026-10-01");
  assert.equal(formatJstDate("2026-10-01T15:00:00Z"), "2026-10-02");
  for (const date of ["2026-02-30", "2026-13-01", "2026-10-02T00:00:00Z", "10/02/2026"]) assert.equal(transportDateSchema.safeParse(date).success, false);
  const { create, enter } = await transportSetup(school); const a = await create(); const cookie = await enter(a.code);
  for (const serviceDate of [school.dates.past, "2026-02-30", "2026-13-01"]) {
    assert.equal((await school.api(noticesUrl, noticeInput(a.profile.id, serviceDate), cookie)).status, 400);
  }
  const saved = await school.api(noticesUrl, noticeInput(a.profile.id, school.dates.original), cookie);
  assert.equal(saved.body.serviceDate, school.dates.original);
  assert.equal((await school.pool.query("SELECT service_date::text FROM transport_notices")).rows[0].service_date, school.dates.original);
});

test("transport input, correction and cancellation close exactly at lesson start in Japan", async () => {
  await school.setClock(parseJstDate(school.dates.original).toISOString());
  const { create, enter } = await transportSetup(school);
  const a = await create(), b = await create(CHILD_B), c = await create("ごうせいてすと そら");
  const cookieA = await enter(a.code), cookieB = await enter(b.code), cookieC = await enter(c.code);
  assert.equal((await school.api("/api/transport/session", undefined, cookieA)).body.today, school.dates.original);
  const start = parseJstDateTime(school.dates.original, "10:00").getTime();
  await school.setClock(new Date(start - 1).toISOString());
  const inputA = noticeInput(a.profile.id, school.dates.original), inputB = noticeInput(b.profile.id, school.dates.original);
  assert.equal((await school.api(noticesUrl, inputA, cookieA)).status, 200);
  assert.equal((await school.api(noticesUrl, inputB, cookieB)).status, 200);
  assert.equal((await school.api(noticesUrl, { ...inputA, direction: "BOTH", expectedVersion: 1 }, cookieA)).status, 200);
  assert.equal((await school.api(noticesUrl, { ...inputB, status: "CANCELLED", expectedVersion: 1 }, cookieB)).status, 200);
  await school.setClock(new Date(start).toISOString());
  for (const delta of [0, 1]) {
    await school.setClock(new Date(start + delta).toISOString());
    assert.equal((await school.api(noticesUrl, noticeInput(c.profile.id, school.dates.original), cookieC)).status, 400);
    assert.equal((await school.api(noticesUrl, { ...inputA, direction: "INBOUND", expectedVersion: 2 }, cookieA)).status, 400);
    assert.equal((await school.api(noticesUrl, { ...inputA, direction: "BOTH", status: "CANCELLED", expectedVersion: 2 }, cookieA)).status, 400);
  }
  const day = (await school.api(dayUrl(a.profile.id), undefined, cookieA)).body;
  assert.equal(day.editable, false); assert.equal(day.deadlineAt, new Date(start).toISOString());
  assert.equal(day.notice.direction, "BOTH"); assert.equal(day.notice.version, 2);
  // Requests waiting for a real row lock must recheck time after the wait.
  await school.setClock(new Date(start - 1).toISOString());
  const blocker = await school.pool.connect();
  await blocker.query("BEGIN");
  await blocker.query("SELECT id FROM transport_profiles WHERE id=$1 FOR UPDATE", [c.profile.id]);
  const pending = school.api(noticesUrl, noticeInput(c.profile.id, school.dates.original), cookieC);
  try {
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      blocked = Number((await school.pool.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0")).rows[0].count) > 0;
      if (blocked) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(blocked);
    await school.setClock(new Date(start).toISOString());
  } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  assert.equal((await pending).status, 400);
});

test("transport stopping a withdrawn child revokes codes and sessions without deleting notices; reissue resumes safely", async () => {
  const { admin, create, enter } = await transportSetup(school);
  const a = await create(); const cookie = await enter(a.code);
  const input = noticeInput(a.profile.id, school.dates.original);
  const saved = await school.api(noticesUrl, input, cookie);
  await school.api(`/api/admin/transport/notices/${saved.body.id}/acknowledge`, { version: 1 }, admin);
  const before = await attendanceSnapshot(school);
  for (let repeat = 0; repeat < 2; repeat++) assert.equal((await school.api(`/api/admin/transport/profiles/${a.profile.id}/stop`, {}, admin)).body.active, false);
  assert.equal((await school.api("/api/transport/access", { code: a.code })).status, 403);
  assert.deepEqual((await school.api("/api/transport/session", undefined, cookie)).body.profiles, []);
  assert.equal((await school.api(dayUrl(a.profile.id), undefined, cookie)).status, 403);
  assert.equal((await school.api(noticesUrl, { ...input, status: "CANCELLED", expectedVersion: 2 }, cookie)).status, 403);
  const staff = (await school.api(`/api/admin/transport/notices?date=${school.dates.original}`, undefined, admin)).body[0];
  assert.equal(staff.version, 2); assert.equal(staff.acknowledgedVersion, null); assert.match(staff.attendanceWarning, /無効/);
  assert.equal((await school.api(`/api/admin/transport/notices/${saved.body.id}/acknowledge`, { version: 1 }, admin)).status, 409);
  const reissued = await school.api(`/api/admin/transport/profiles/${a.profile.id}/rotate-code`, {}, admin);
  assert.equal(reissued.body.profile.active, true);
  assert.equal((await school.api("/api/transport/access", { code: a.code })).status, 403);
  const fresh = await enter(reissued.body.code);
  assert.equal((await school.api(dayUrl(a.profile.id), undefined, fresh)).body.notice.id, saved.body.id);
  assert.deepEqual(await attendanceSnapshot(school), before);
});

test("transport code access rate limit rejects the sixteenth failed attempt", async () => {
  const isolated = await createSchoolFixture();
  try {
    for (let attempt = 0; attempt < 15; attempt++) assert.equal((await isolated.api("/api/transport/access", { code: "invalid-synthetic-code" })).status, 403);
    assert.equal((await isolated.api("/api/transport/access", { code: "invalid-synthetic-code" })).status, 429);
  } finally { await isolated.dispose(); }
});

test("transport secrets are hashed, request validation rejects excess notes and browser cross-origin writes", async () => {
  const { admin, create, enter } = await transportSetup(school); const a = await create(); const cookie = await enter(a.code);
  const dbRow = (await school.pool.query("SELECT code_hash FROM transport_profiles WHERE id=$1", [a.profile.id])).rows[0];
  assert.equal(dbRow.code_hash.length, 64); assert.notEqual(dbRow.code_hash, a.code);
  const profiles = await school.api("/api/admin/transport/profiles", undefined, admin);
  assert.ok(!JSON.stringify(profiles.body).includes(a.code)); assert.ok(!JSON.stringify(profiles.body).includes(dbRow.code_hash));
  assert.equal((await school.api(noticesUrl, noticeInput(a.profile.id, school.dates.original, { note: "あ".repeat(301) }), cookie)).status, 400);
  const cross = await fetch(school.baseURL + noticesUrl, { method: "POST", headers: { Origin: "https://example.invalid", "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(noticeInput(a.profile.id, school.dates.original)) });
  assert.equal(cross.status, 403);
  const form = await fetch(school.baseURL + noticesUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie }, body: "status=ACTIVE" });
  assert.equal(form.status, 415);
});

test("transport additive migration and destructive local rollback preserve all existing attendance data", async () => {
  const { create, enter } = await transportSetup(school); const a = await create(); const cookie = await enter(a.code);
  await school.api(noticesUrl, noticeInput(a.profile.id, school.dates.original), cookie);
  const absent = await school.absence(CHILD_B);
  assert.equal((await school.api("/api/book", school.booking(absent.absenceId, CHILD_B))).status, 200);
  const before = await attendanceSnapshot(school);
  const rollback = await readFile(new URL("../../db/local-migrations/20261002_transport.rollback.sql", import.meta.url), "utf8");
  const migrate = await readFile(new URL("../../db/local-migrations/20261002_transport.sql", import.meta.url), "utf8");
  await school.pool.query(rollback);
  assert.deepEqual(await attendanceSnapshot(school), before);
  await school.pool.query(migrate);
  assert.equal((await school.pool.query("SELECT count(*) FROM transport_notices")).rows[0].count, "0");
  assert.deepEqual(await attendanceSnapshot(school), before);
});

test("self entry needs no staff registration, owns one receipt, and preserves attendance", async () => {
  const { selfSubmission } = await import("./transport-helpers");
  const before = await attendanceSnapshot(school);
  const saved = await selfSubmission(school);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.receiptCode, saved.input.receiptCode);
  assert.equal(saved.body.profile.selfSubmitted, true);
  assert.equal(saved.body.profile.serviceDate, school.dates.original);
  assert.equal(saved.body.profile.codeHash, undefined);
  const profileId = saved.body.profile.id;
  const session = await school.api("/api/transport/session", undefined, saved.cookie!);
  assert.deepEqual(session.body.profiles.map((x: any) => x.id), [profileId]);
  let version = 1;
  for (const direction of ["INBOUND", "BOTH", "OUTBOUND"]) {
    const result = await school.api(noticesUrl, noticeInput(profileId, school.dates.original, { direction, expectedVersion: version }), saved.cookie!);
    assert.equal(result.status, 200, JSON.stringify(result.body)); version++;
  }
  const login = await school.api("/api/admin/login", { loginId: "admin", password: PASSWORD });
  assert.equal((await school.api("/api/admin/transport/notices/" + saved.body.notice.id + "/acknowledge", { version }, login.cookie!)).status, 200);
  const cancelled = await school.api(noticesUrl, noticeInput(profileId, school.dates.original, { status: "CANCELLED", expectedVersion: version }), saved.cookie!);
  assert.equal(cancelled.status, 200); assert.equal(cancelled.body.acknowledgedVersion, null);
  assert.deepEqual(await attendanceSnapshot(school), before);
  assert.equal((await school.pool.query("SELECT count(*) FROM courses")).rows[0].count, "0");
  assert.notEqual((await school.pool.query("SELECT code_hash FROM transport_profiles")).rows[0].code_hash, saved.input.receiptCode);
  assert.deepEqual(await school.deliveries(), []);
});

test("self entry does not grant access to same-name households or reveal their attendance", async () => {
  const { selfSubmission } = await import("./transport-helpers");
  await school.absence();
  const { admin, create, enter } = await transportSetup(school);
  const old = await create(CHILD_B), oldCookie = await enter(old.code);
  await school.api(noticesUrl, noticeInput(old.profile.id, school.dates.original, { note: "別家庭の非公開メモ" }), oldCookie);
  const a = await selfSubmission(school), b = await selfSubmission(school, { childName: CHILD_B, note: "自分の連絡" });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.notEqual(b.body.profile.id, old.profile.id);
  const ownDay = await school.api(dayUrl(a.body.profile.id), undefined, a.cookie!);
  assert.equal(ownDay.body.eligible, true);
  assert.equal(ownDay.body.reason, null); // No public attendance oracle based on an entered name.
  for (const id of [old.profile.id, b.body.profile.id]) {
    assert.equal((await school.api(dayUrl(id), undefined, a.cookie!)).status, 403);
    for (const status of ["ACTIVE", "CANCELLED"]) assert.equal((await school.api(noticesUrl,
      noticeInput(id, school.dates.original, { status, expectedVersion: 1 }), a.cookie!)).status, 403);
  }
  assert.equal((await school.api(dayUrl(a.body.profile.id))).status, 401);
  assert.deepEqual((await school.api("/api/transport/session")).body.profiles, []);
  assert.ok(!JSON.stringify(b.body).includes("別家庭の非公開メモ"));
  assert.ok(!JSON.stringify(ownDay.body).includes("欠席連絡"));
  const staff = await school.api("/api/admin/transport/notices?date=" + school.dates.original, undefined, admin);
  assert.match(staff.body.find((x: any) => x.profileId === a.body.profile.id).attendanceWarning, /欠席連絡/);
  assert.match(staff.body.find((x: any) => x.profileId === b.body.profile.id).attendanceWarning, /同名の連絡が複数/);
});

test("self entry retries are atomic and never overwrite an existing receipt's edits", async () => {
  const { selfSubmission } = await import("./transport-helpers");
  const { randomBytes } = await import("node:crypto");
  const receiptCode = "R-" + randomBytes(18).toString("base64url");
  // The first requests race while neither the profile nor the notice exists.
  const results = await Promise.all([selfSubmission(school, { receiptCode }), selfSubmission(school, { receiptCode })]);
  const first = results[0];
  assert.deepEqual(results.map(r => r.status), [200, 200]);
  assert.ok(results.every(r => r.body.notice.id === first.body.notice.id));
  const edit = await school.api(noticesUrl, noticeInput(first.body.profile.id, school.dates.original,
    { direction: "BOTH", expectedVersion: 1 }), first.cookie!);
  assert.equal(edit.status, 200);
  const repeat = await school.api("/api/transport/submissions", first.input);
  assert.equal(repeat.body.notice.version, 2); assert.equal(repeat.body.notice.direction, "BOTH");
  assert.equal((await school.api("/api/transport/submissions", { ...first.input, childName: CHILD_B })).status, 409);
  const counts = await school.pool.query("SELECT (SELECT count(*) FROM transport_profiles)::int AS profiles, (SELECT count(*) FROM transport_notices)::int AS notices");
  assert.deepEqual(counts.rows[0], { profiles: 1, notices: 1 });
});

test("self entry validates lesson/date/class and cannot reuse a receipt on another day", async () => {
  const { selfSubmission } = await import("./transport-helpers");
  for (const fields of [{ serviceDate: "2026-02-30" }, { slotId: "unknown" }, { classBand: "中級" },
    { serviceDate: school.dates.makeup }, { note: "あ".repeat(301) }, { profileId: "cannot-claim-a-profile" }]) {
    const result = await selfSubmission(school, fields);
    assert.equal(result.status, 400, JSON.stringify(result.body));
  }
  assert.equal((await school.pool.query("SELECT count(*) FROM transport_profiles")).rows[0].count, "0");
  const saved = await selfSubmission(school);
  assert.equal(saved.status, 200);
  assert.equal((await school.api(noticesUrl, noticeInput(saved.body.profile.id, school.dates.later), saved.cookie!)).status, 400);
  const anotherDay = await school.api(dayUrl(saved.body.profile.id, school.dates.later), undefined, saved.cookie!);
  assert.equal(anotherDay.body.notice, null); assert.equal(anotherDay.body.editable, false);
});

test("self entry closes creation, correction and cancellation exactly at lesson start", async () => {
  const { selfSubmission } = await import("./transport-helpers");
  const start = parseJstDateTime(school.dates.original, "10:00").getTime();
  await school.setClock(new Date(start - 1).toISOString());
  const saved = await selfSubmission(school); assert.equal(saved.status, 200);
  await school.setClock(new Date(start).toISOString());
  assert.equal((await selfSubmission(school, { childName: CHILD_B })).status, 400);
  for (const status of ["ACTIVE", "CANCELLED"]) assert.equal((await school.api(noticesUrl,
    noticeInput(saved.body.profile.id, school.dates.original, { status, direction: "BOTH", expectedVersion: 1 }), saved.cookie!)).status, 400);
  assert.equal((await school.api(dayUrl(saved.body.profile.id), undefined, saved.cookie!)).body.editable, false);
  assert.equal((await school.api("/api/transport/submissions", saved.input)).body.notice.version, 1); // read-only retry
});

test("self entry rechecks the deadline after a real database lock wait", async () => {
  const { selfSubmission } = await import("./transport-helpers");
  const start = parseJstDateTime(school.dates.original, "10:00").getTime();
  await school.setClock(new Date(start - 100).toISOString());
  const lock = await school.pool.connect();
  try {
    await lock.query("BEGIN"); await lock.query("LOCK TABLE transport_profiles IN SHARE MODE");
    const pending = selfSubmission(school);
    for (let i = 0; i < 100; i++) {
      const waiting = await school.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0");
      if (waiting.rows[0].n) break;
      if (i === 99) throw new Error("Submission did not reach the lock");
      await new Promise(resolve => setTimeout(resolve,10));
    }
    await school.setClock(new Date(start).toISOString()); await lock.query("COMMIT");
    assert.equal((await pending).status, 400);
    assert.equal((await school.pool.query("SELECT count(*) FROM transport_notices")).rows[0].count, "0");
  } finally { await lock.query("ROLLBACK"); lock.release(); }
});

test("self receipt recovery requires the receipt; anonymous, other parents and coaches cannot acknowledge", async () => {
  const { selfSubmission } = await import("./transport-helpers");
  const saved = await selfSubmission(school);
  await school.pool.query("UPDATE admin_sessions SET sess=jsonb_set(sess::jsonb,'{transportUntil}','0')::json WHERE sess::jsonb ? 'transportUntil'");
  assert.equal((await school.api(dayUrl(saved.body.profile.id), undefined, saved.cookie!)).status, 401);
  const recovered = await school.api("/api/transport/access", { code: saved.body.receiptCode });
  assert.equal(recovered.status, 200);
  assert.equal((await school.api(dayUrl(saved.body.profile.id), undefined, recovered.cookie!)).body.notice.id, saved.body.notice.id);
  const coach = await school.api("/api/admin/login", { loginId: "synthetic-coach", password: PASSWORD });
  for (const cookie of [undefined, recovered.cookie!, coach.cookie!]) {
    assert.equal((await school.api("/api/admin/transport/notices/" + saved.body.notice.id + "/acknowledge", { version: 1 }, cookie)).status, 401);
  }
  const cross = await fetch(school.baseURL + "/api/transport/submissions", { method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://unrelated.invalid" }, body: JSON.stringify(saved.input) });
  assert.equal(cross.status, 403);
});


test("transport lesson choices group matching grades, retain distinct courses, and disclose only lesson metadata", async () => {
  await school.pool.query("INSERT INTO class_slots(id,date,start_time,course_label,class_band,lesson_start_date_time,capacity_limit,capacity_current) SELECT 'same-course-middle',date,start_time,course_label,'中級',lesson_start_date_time,capacity_limit,capacity_current FROM class_slots WHERE id=$1", [school.ids.original]);
  await school.pool.query("INSERT INTO class_slots(id,date,start_time,course_label,class_band,lesson_start_date_time,capacity_limit,capacity_current) SELECT 'other-course-upper',date,start_time,'別コース','上級',lesson_start_date_time,capacity_limit,capacity_current FROM class_slots WHERE id=$1", [school.ids.original]);
  const list = await school.api("/api/transport/lessons?date=" + school.dates.original);
  assert.equal(list.status, 200); assert.equal(list.body.slots.length, 3);
  assert.equal(list.body.slots.filter((slot: any) => slot.startTime === "10:00").length, 2);
  assert.deepEqual(Object.keys(list.body.slots[0]).sort(), ["id", "date", "startTime", "courseLabel", "lessonStartDateTime", "isPastLesson"].sort());
  assert.equal((await school.api("/api/transport/lessons?date=2026-02-30")).status, 400);
  const later = await school.api("/api/transport/lessons?date=" + school.dates.makeup);
  assert.equal(later.body.slots.length, 2); // Closed lesson excluded, full lesson still valid for attendance.
  assert.equal((await school.api("/api/class-slots?date=" + school.dates.original)).status, 400); // Absence API unchanged.
  await school.setClock(parseJstDateTime(school.dates.original, "10:00").toISOString());
  const started = await school.api("/api/transport/lessons?date=" + school.dates.original);
  assert.ok(started.body.slots.filter((slot: any) => slot.startTime === "10:00").every((slot: any) => slot.isPastLesson));
});

test("transport derives all grouped lesson grades server-side and retains old single-grade receipts", async () => {
  const { selfSubmission } = await import("./transport-helpers");
  await school.pool.query("INSERT INTO class_slots(id,date,start_time,course_label,class_band,lesson_start_date_time,capacity_limit,capacity_current) SELECT 'same-course-middle',date,start_time,course_label,'中級',lesson_start_date_time,capacity_limit,capacity_current FROM class_slots WHERE id=$1", [school.ids.original]);
  await school.absence(CHILD_A, { classBand: "中級", originalSlotId: "same-course-middle" });
  const before = await attendanceSnapshot(school);
  const modern = await selfSubmission(school);
  assert.equal(modern.status, 200, JSON.stringify(modern.body));
  assert.deepEqual(modern.body.profile.classBand.split("/").sort(), ["中級", "初級"].sort());
  assert.match(modern.body.profile.courseId, /^self-service:v2:/);
  assert.ok(modern.body.profile.courseId.includes("same-course-middle"));
  const day = await school.api(dayUrl(modern.body.profile.id), undefined, modern.cookie!);
  assert.equal(day.body.eligible, true); assert.equal(day.body.reason, null);
  assert.equal(day.body.lessonLabel, "合成回帰テスト");
  const admin = await school.api("/api/admin/login", { loginId: "admin", password: PASSWORD });
  const staff = await school.api("/api/admin/transport/notices?date=" + school.dates.original, undefined, admin.cookie!);
  assert.match(staff.body[0].attendanceWarning, /欠席連絡/); // The middle-grade absence remains visible to staff.
  const legacy = await selfSubmission(school, { childName: CHILD_B, classBand: "初級" });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.profile.classBand, "初級");
  assert.match(legacy.body.profile.courseId, /^self-service:v1:/);
  const recovered = await school.api("/api/transport/access", { code: legacy.body.receiptCode });
  assert.equal((await school.api(dayUrl(legacy.body.profile.id), undefined, recovered.cookie!)).body.notice.id, legacy.body.notice.id);
  assert.equal((await school.api(noticesUrl, noticeInput(legacy.body.profile.id, school.dates.original, { status: "CANCELLED", expectedVersion: 1 }), recovered.cookie!)).status, 200);
  assert.deepEqual(await attendanceSnapshot(school), before);
});
