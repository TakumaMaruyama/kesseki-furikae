import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createSchoolFixture, CHILD_A, CHILD_B, PASSWORD, type SchoolFixture } from "./fixture";

let school: SchoolFixture;
before(async () => { school = await createSchoolFixture(); }, { timeout: 60_000 });
beforeEach(async () => { await school.reset(); });
after(async () => { await school?.dispose(); });

async function slot(id: string) {
  return (await school.pool.query("SELECT capacity_current, capacity_makeup_used FROM class_slots WHERE id=$1", [id])).rows[0];
}
async function absenceState(id: string) {
  return (await school.pool.query("SELECT makeup_status FROM absences WHERE id=$1", [id])).rows[0].makeup_status;
}
async function requestFor(id: string) {
  return (await school.pool.query("SELECT * FROM requests WHERE absence_id=$1 AND status='確定'", [id])).rows[0];
}

async function seedTwoBookings(withEmail = false) {
  await school.pool.query("UPDATE class_slots SET capacity_limit=4 WHERE id=$1", [school.ids.available]);
  const a = await school.absence(CHILD_A, withEmail ? { contactEmail: "synthetic@example.invalid" } : {});
  const b = await school.absence(CHILD_B);
  for (const [absence, name] of [[a, CHILD_A], [b, CHILD_B]]) {
    assert.equal((await school.api("/api/book", school.booking(absence.absenceId, name))).status, 200);
  }
  return { a, b, requestA: await requestFor(a.absenceId), requestB: await requestFor(b.absenceId) };
}

async function assertOccupiedSeats(id: string, expected: number) {
  const confirmed = await school.pool.query("SELECT count(*) FROM requests WHERE to_slot_id=$1 AND status='確定'", [id]);
  assert.equal(Number(confirmed.rows[0].count), expected);
  assert.equal((await slot(id)).capacity_makeup_used, expected,
    "The occupancy counter must match the confirmed reservations that remain");
}

async function runBlockedCancellations(
  lockSql: string, parameters: string[], actions: Array<() => ReturnType<SchoolFixture["api"]>>,
) {
  const blocker = await school.pool.connect();
  const pending: Array<ReturnType<SchoolFixture["api"]>> = [];
  let blocked = 0;
  try {
    await blocker.query("BEGIN");
    await blocker.query(lockSql, parameters);
    // Start in the requested order and observe each real lock wait before the next call.
    for (const action of actions) {
      pending.push(action());
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        blocked = Number((await school.pool.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid)) > 0")).rows[0].count);
        if (blocked >= pending.length) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (blocked < pending.length) break;
    }
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
  const results = await Promise.all(pending);
  assert.equal(pending.length, actions.length, "Every cancellation must enter the intended overlap");
  assert.ok(blocked >= actions.length, "Real PostgreSQL lock waits are required to prove the overlap");
  assert.deepEqual(results.map((r) => r.status), actions.map(() => 200), JSON.stringify(results));
  return results;
}

test("absence → confirmation lookup → booking → booking cancellation → absence cancellation", async () => {
  const absence = await school.absence(CHILD_A, { contactEmail: "synthetic@example.invalid", reason: "合成テスト理由" });
  assert.equal((await slot(school.ids.original)).capacity_current, 4);
  const lookup = await school.api(`/api/lookup/${absence.confirmCode}`);
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.absences[0].id, absence.absenceId);
  for (const privateKey of ["resumeToken", "contactEmail", "reason"]) assert.ok(!(privateKey in lookup.body.absences[0]));
  const capability = await school.api("/api/booking-token", { confirmCode: absence.confirmCode, absenceId: absence.absenceId });
  assert.equal(capability.body.resumeToken, absence.resumeToken);
  const booking = await school.api("/api/book", school.booking(absence.absenceId));
  assert.equal(booking.status, 200, JSON.stringify(booking.body));
  assert.equal(await absenceState(absence.absenceId), "MAKEUP_CONFIRMED");
  assert.equal((await slot(school.ids.available)).capacity_makeup_used, 1);
  const request = await requestFor(absence.absenceId);
  assert.equal(request.child_name, CHILD_A);
  assert.equal((await school.api("/api/cancel-request", { requestId: request.id, cancelToken: "wrong-synthetic-token" })).status, 403);
  assert.equal((await slot(school.ids.available)).capacity_makeup_used, 1);
  for (const alreadyCancelled of [false, true]) {
    const result = await school.api("/api/cancel-request", { requestId: request.id, cancelToken: request.cancel_token });
    assert.equal(result.status, 200);
    assert.equal(result.body.alreadyCancelled, alreadyCancelled);
  }
  assert.equal((await slot(school.ids.available)).capacity_makeup_used, 0);
  assert.equal(await absenceState(absence.absenceId), "PENDING");
  for (const alreadyCancelled of [false, true]) {
    const result = await school.api("/api/cancel-absence", { resumeToken: absence.resumeToken });
    assert.equal(result.status, 200);
    assert.equal(result.body.alreadyCancelled, alreadyCancelled);
  }
  assert.equal((await slot(school.ids.original)).capacity_current, 5);
  assert.equal(await absenceState(absence.absenceId), "CANCELLED");
  assert.deepEqual((await school.deliveries()).map((item) => item.kind), ["absence", "makeup", "booking-cancel", "absence-cancel"]);
});

test("siblings have separate confirmation codes, names, grades and cancellation state", async () => {
  const result = await school.api("/api/absences/batch", { reportType: "ABSENCE", items: [
    school.input(CHILD_A), school.input(CHILD_B, { classBand: "中級", originalSlotId: school.ids.sibling }),
  ] });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const [a, b] = result.body.items;
  assert.notEqual(a.confirmCode, b.confirmCode);
  assert.notEqual(a.resumeToken, b.resumeToken);
  for (const [item, name, band] of [[a, CHILD_A, "初級"], [b, CHILD_B, "中級"]]) {
    const details = await school.api(`/api/absences/${item.resumeToken}`);
    assert.equal(details.body.childName, name);
    assert.equal(details.body.declaredClassBand, band);
  }
  assert.equal((await school.api("/api/booking-token", { confirmCode: a.confirmCode, absenceId: b.absenceId })).status, 403);
  await school.api("/api/cancel-absence", { resumeToken: a.resumeToken });
  assert.equal(await absenceState(a.absenceId), "CANCELLED");
  assert.equal(await absenceState(b.absenceId), "PENDING");
  assert.equal((await slot(school.ids.original)).capacity_current, 5);
  assert.equal((await slot(school.ids.sibling)).capacity_current, 4);
});

test("invalid second sibling rolls back the entire batch without sending email", async () => {
  const result = await school.api("/api/absences/batch", {
    reportType: "ABSENCE", contactEmail: "synthetic@example.invalid", items: [school.input(), school.input(CHILD_B, { originalSlotId: school.ids.sibling })],
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.rowIndex, 1);
  assert.equal(Number((await school.pool.query("SELECT count(*) FROM absences")).rows[0].count), 0);
  assert.equal((await slot(school.ids.original)).capacity_current, 5);
  assert.equal((await slot(school.ids.sibling)).capacity_current, 5);
  assert.deepEqual(await school.deliveries(), []);
});

test("duplicate absence with whitespace variation returns the existing code without decrementing twice", async () => {
  const a = await school.absence();
  const again = await school.api("/api/absences", school.input("ごうせいてすと　あおい"));
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "DUPLICATE_ABSENCE");
  assert.equal(again.body.confirmCode, a.confirmCode);
  assert.equal((await slot(school.ids.original)).capacity_current, 4);
});

test("late notification does not free a seat and cannot be used for makeup", async () => {
  const a = await school.absence(CHILD_A, { reportType: "LATE" });
  assert.equal((await slot(school.ids.original)).capacity_current, 5);
  const result = await school.api("/api/book", school.booking(a.absenceId));
  assert.equal(result.status, 400);
  assert.match(result.body.message, /遅刻/);
  assert.equal((await slot(school.ids.available)).capacity_makeup_used, 0);
});

test("slot search excludes wrong grade, closed and past lessons and counts trial participants", async () => {
  await school.pool.query("INSERT INTO trial_participants(participant_name,grade,swim_level,slot_id) VALUES ('合成体験者','合成学年','合成泳力',$1)", [school.ids.available]);
  const result = await school.api("/api/search-slots", school.input());
  assert.equal(result.status, 200);
  const byId = new Map(result.body.map((row: any) => [row.slotId, row]));
  for (const id of [school.ids.closed, school.ids.past, school.ids.sibling]) assert.ok(!byId.has(id));
  const available = byId.get(school.ids.available) as any;
  assert.equal(available.statusCode, "×");
  assert.equal(available.remainingSlots, 0);
  assert.equal(available.trialParticipantCount, 1);
  const a = await school.absence();
  assert.equal((await school.api("/api/book", school.booking(a.absenceId))).status, 400);
  assert.equal(await absenceState(a.absenceId), "PENDING");
});

for (const [scenario, message, transform] of [
  ["full", /満席/, (s: SchoolFixture) => ({ toSlotId: s.ids.full })],
  ["closed", /休講/, (s: SchoolFixture) => ({ toSlotId: s.ids.closed })],
  ["past", /開始時刻/, (s: SchoolFixture) => ({ toSlotId: s.ids.past })],
  ["wrong grade", /クラス帯/, () => ({ classBand: "中級" })],
  ["wrong child", /一致しません/, () => ({ childName: CHILD_B })],
  ["missing absence", /欠席情報が必要/, () => ({ absenceId: undefined })],
] as const) {
  test(`booking rejects ${scenario} and preserves pending absence/capacity`, async () => {
    const a = await school.absence();
    const result = await school.api("/api/book", school.booking(a.absenceId, CHILD_A, school.ids.available, transform(school)));
    assert.equal(result.status, 400);
    assert.match(result.body.message, message);
    assert.equal(await absenceState(a.absenceId), "PENDING");
    assert.equal((await slot(school.ids.available)).capacity_makeup_used, 0);
    assert.equal(Number((await school.pool.query("SELECT count(*) FROM requests")).rows[0].count), 0);
  });
}

test("expired and cancelled absences cannot book", async () => {
  const a = await school.absence();
  await school.pool.query("UPDATE absences SET makeup_deadline = now() - interval '2 days' WHERE id=$1", [a.absenceId]);
  const expired = await school.api("/api/book", school.booking(a.absenceId));
  assert.equal(expired.status, 400);
  assert.match(expired.body.message, /期限/);
  await school.api("/api/cancel-absence", { resumeToken: a.resumeToken });
  const cancelled = await school.api("/api/book", school.booking(a.absenceId));
  assert.equal(cancelled.status, 400);
  assert.match(cancelled.body.message, /キャンセル済み/);
  assert.equal((await slot(school.ids.available)).capacity_makeup_used, 0);
});

test("two simultaneous bookings for one absence create exactly one reservation", async () => {
  const a = await school.absence();
  const results = await Promise.all([school.ids.available, school.ids.later].map((id) => school.api("/api/book", school.booking(a.absenceId, CHILD_A, id))));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  assert.equal(Number((await school.pool.query("SELECT count(*) FROM requests WHERE status='確定'")).rows[0].count), 1);
  assert.equal((await slot(school.ids.available)).capacity_makeup_used + (await slot(school.ids.later)).capacity_makeup_used, 1);
});

test("two children contesting the last seat preserve capacity and roll back the loser", async () => {
  const a = await school.absence();
  const b = await school.absence(CHILD_B);
  const results = await Promise.all([[a, CHILD_A], [b, CHILD_B]].map(([absence, name]) => school.api("/api/book", school.booking(absence.absenceId, name))));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  assert.equal((await slot(school.ids.available)).capacity_makeup_used, 1);
  assert.deepEqual([await absenceState(a.absenceId), await absenceState(b.absenceId)].sort(), ["MAKEUP_CONFIRMED", "PENDING"]);
});

test("expired staff session rejects writes, and fresh login restores access", async () => {
  assert.equal((await school.api("/api/admin/courses")).status, 401);
  const login = await school.api("/api/admin/login", { loginId: "admin", password: PASSWORD });
  assert.equal(login.status, 200);
  assert.ok(login.cookie);
  assert.equal((await school.api("/api/admin/courses", undefined, login.cookie)).status, 200);
  await school.expireSessions();
  const check = await school.api("/api/staff/check", undefined, login.cookie);
  assert.equal(check.body.authenticated, false);
  const rejected = await school.api("/api/admin/courses", { name: "失効後合成", dayOfWeek: "月", startTime: "10:00" }, login.cookie);
  assert.equal(rejected.status, 401);
  assert.equal(Number((await school.pool.query("SELECT count(*) FROM courses")).rows[0].count), 0);
  const fresh = await school.api("/api/admin/login", { loginId: "admin", password: PASSWORD });
  assert.equal(fresh.status, 200);
  assert.notEqual(fresh.cookie, login.cookie);
  assert.equal((await school.api("/api/admin/courses", undefined, fresh.cookie)).status, 200);
});

test("coach session cannot use administrator writes", async () => {
  const login = await school.api("/api/admin/login", { loginId: "synthetic-coach", password: PASSWORD });
  assert.equal(login.status, 200);
  assert.equal((await school.api("/api/staff/check", undefined, login.cookie)).body.role, "coach");
  assert.equal((await school.api("/api/admin/book-without-absence", school.booking(""), login.cookie)).status, 401);
  assert.equal((await school.api(`/api/coach/daily-status?date=${school.dates.original}`, undefined, login.cookie)).status, 200);
});

test("simultaneous cancellation of the same booking must retain another child's occupied seat", async () => {
  const { a, b, requestA } = await seedTwoBookings(true);
  const payload = { requestId: requestA.id, cancelToken: requestA.cancel_token };
  const cancel = () => school.api("/api/cancel-request", payload);
  const results = await runBlockedCancellations("SELECT id FROM requests WHERE id=$1 FOR UPDATE", [requestA.id], [cancel, cancel]);
  assert.equal((await requestFor(b.absenceId)).child_name, CHILD_B);
  await assertOccupiedSeats(school.ids.available, 1);
  assert.deepEqual(results.map((r) => r.body.alreadyCancelled).sort(), [false, true]);
  assert.equal(await absenceState(a.absenceId), "PENDING");
  const retry = await cancel();
  assert.equal(retry.status, 200);
  assert.equal(retry.body.alreadyCancelled, true);
  await assertOccupiedSeats(school.ids.available, 1);
  assert.equal((await school.deliveries()).filter((entry) => entry.kind === "booking-cancel").length, 1);
});

for (const first of ["booking", "absence"] as const) {
  test(`cancellation overlaps booking and absence cancellation (${first} first) without a deadlock or double decrement`, async () => {
    const { a, b, requestA } = await seedTwoBookings();
    const cancelBooking = () => school.api("/api/cancel-request", { requestId: requestA.id, cancelToken: requestA.cancel_token });
    const cancelAbsence = () => school.api("/api/cancel-absence", { resumeToken: a.resumeToken });
    const actions = first === "booking" ? [cancelBooking, cancelAbsence] : [cancelAbsence, cancelBooking];
    await runBlockedCancellations("SELECT id FROM requests WHERE id=$1 FOR UPDATE", [requestA.id], actions);
    await assertOccupiedSeats(school.ids.available, 1);
    assert.equal((await requestFor(b.absenceId)).child_name, CHILD_B);
    assert.equal(await absenceState(a.absenceId), "CANCELLED");
    assert.equal(await absenceState(b.absenceId), "MAKEUP_CONFIRMED");
    assert.equal((await slot(school.ids.original)).capacity_current, 4);
    const retries = await Promise.all([cancelBooking(), cancelAbsence()]);
    assert.deepEqual(retries.map((r) => r.body.alreadyCancelled), [true, true]);
    await assertOccupiedSeats(school.ids.available, 1);
    assert.equal((await slot(school.ids.original)).capacity_current, 4);
  });
}

test("cancellation of two different bookings in parallel preserves a third child's seat", async () => {
  const { a, b, requestA, requestB } = await seedTwoBookings();
  await school.pool.query("UPDATE class_slots SET capacity_limit=5 WHERE id=$1", [school.ids.available]);
  const childC = "ごうせいてすと そら";
  const c = await school.absence(childC);
  assert.equal((await school.api("/api/book", school.booking(c.absenceId, childC))).status, 200);
  await runBlockedCancellations("SELECT id FROM class_slots WHERE id=$1 FOR UPDATE", [school.ids.available],
    [requestA, requestB].map((request) => () => school.api("/api/cancel-request", { requestId: request.id, cancelToken: request.cancel_token })));
  await assertOccupiedSeats(school.ids.available, 1);
  assert.equal((await requestFor(c.absenceId)).child_name, childC);
  assert.equal(await absenceState(a.absenceId), "PENDING");
  assert.equal(await absenceState(b.absenceId), "PENDING");
});

test("cancellation of an admin booking without an absence is safe across two entry points", async () => {
  await school.pool.query("UPDATE class_slots SET capacity_limit=4 WHERE id=$1", [school.ids.available]);
  const login = await school.api("/api/admin/login", { loginId: "admin", password: PASSWORD });
  assert.equal(login.status, 200);
  const booked = await school.api("/api/admin/book-without-absence", { ...school.input(), toSlotId: school.ids.available }, login.cookie);
  assert.equal(booked.status, 200, JSON.stringify(booked.body));
  const b = await school.absence(CHILD_B);
  assert.equal((await school.api("/api/book", school.booking(b.absenceId, CHILD_B))).status, 200);
  const request = (await school.pool.query("SELECT * FROM requests WHERE child_name=$1", [CHILD_A])).rows[0];
  assert.equal(request.absence_id, null);
  const results = await runBlockedCancellations("SELECT id FROM requests WHERE id=$1 FOR UPDATE", [request.id], [
    () => school.api("/api/cancel-request", { requestId: request.id, cancelToken: request.cancel_token }),
    () => school.api(`/api/cancel/${request.cancel_token}`, {}),
  ]);
  assert.deepEqual(results.map((r) => r.body.alreadyCancelled).sort(), [false, true]);
  await assertOccupiedSeats(school.ids.available, 1);
  assert.equal((await requestFor(b.absenceId)).child_name, CHILD_B);
});

test("cancellation retry after rebooking leaves the replacement and another child's reservation intact", async () => {
  const { a, b, requestA } = await seedTwoBookings();
  assert.equal((await school.api("/api/cancel-request", { requestId: requestA.id, cancelToken: requestA.cancel_token })).status, 200);
  assert.equal((await school.api("/api/book", school.booking(a.absenceId, CHILD_A, school.ids.later))).status, 200);
  const retries = await Promise.all([
    school.api(`/api/cancel/${requestA.cancel_token}`, {}),
    school.api(`/api/cancel-request/${requestA.id}`, { confirmCode: a.confirmCode }),
  ]);
  assert.deepEqual(retries.map((r) => r.status), [200, 200]);
  assert.deepEqual(retries.map((r) => r.body.alreadyCancelled), [true, true]);
  assert.equal(await absenceState(a.absenceId), "MAKEUP_CONFIRMED");
  assert.equal((await requestFor(a.absenceId)).to_slot_id, school.ids.later);
  assert.equal((await requestFor(b.absenceId)).child_name, CHILD_B);
  await assertOccupiedSeats(school.ids.available, 1);
  await assertOccupiedSeats(school.ids.later, 1);
});

test("cancellation of the same absence concurrently restores the original seat only once", async () => {
  const { a, b } = await seedTwoBookings();
  const cancel = () => school.api("/api/cancel-absence", { resumeToken: a.resumeToken });
  const results = await runBlockedCancellations("SELECT id FROM absences WHERE id=$1 FOR UPDATE", [a.absenceId], [cancel, cancel]);
  assert.deepEqual(results.map((r) => r.body.alreadyCancelled).sort(), [false, true]);
  assert.equal(await absenceState(a.absenceId), "CANCELLED");
  assert.equal((await slot(school.ids.original)).capacity_current, 4);
  assert.equal((await requestFor(b.absenceId)).child_name, CHILD_B);
  await assertOccupiedSeats(school.ids.available, 1);
});
