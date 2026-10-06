import assert from "node:assert/strict";
import { getJstDayOfWeek, parseJstDate } from "../../shared/jst";
import { CHILD_A, PASSWORD, type SchoolFixture } from "./fixture";

export async function transportSetup(school: SchoolFixture) {
  await school.pool.query("INSERT INTO courses(id,name,day_of_week,start_time) VALUES ('transport-course','合成送迎コース',$1,'10:00')", ["日月火水木金土"[getJstDayOfWeek(parseJstDate(school.dates.original))]]);
  const login = await school.api("/api/admin/login", { loginId: "admin", password: PASSWORD });
  assert.equal(login.status, 200);
  const admin = login.cookie!;
  const create = async (childName = CHILD_A, overrides = {}) => {
    const result = await school.api("/api/admin/transport/profiles", { childName, classBand: "初級", courseId: "transport-course", outbound: true, inbound: true, ...overrides }, admin);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body as { profile: { id: string; childName: string }; code: string };
  };
  const enter = async (code: string, cookie?: string) => {
    const result = await school.api("/api/transport/access", { code }, cookie);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.cookie!;
  };
  return { admin, create, enter };
}
export const noticeInput = (profileId: string, serviceDate: string, overrides = {}) => ({
  profileId, serviceDate, direction: "OUTBOUND", note: "保護者が送ります", status: "ACTIVE", expectedVersion: 0, ...overrides,
});
export async function attendanceSnapshot(school: SchoolFixture) {
  const snapshots: Record<string, unknown> = {};
  for (const table of ["absences", "requests", "class_slots", "children", "users"]) {
    snapshots[table] = (await school.pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  }
  return snapshots;
}

export async function selfSubmission(school: SchoolFixture, overrides = {}, cookie?: string) {
  const { randomBytes } = await import("node:crypto");
  const input = { childName: CHILD_A, serviceDate: school.dates.original,
    slotId: school.ids.original, direction: "OUTBOUND", note: "保護者が送ります",
    receiptCode: "R-" + randomBytes(18).toString("base64url"), ...overrides };
  const response = await school.api("/api/transport/submissions", input, cookie);
  return { ...response, input };
}
