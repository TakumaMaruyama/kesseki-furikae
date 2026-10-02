import type { Express, Request, RequestHandler } from "express";
import { createHash, randomBytes } from "node:crypto";
import rateLimit from "express-rate-limit";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { z, ZodError } from "zod";
import { db } from "./db";
import { absences, classSlots, courses, requests, transportNotices, transportProfiles } from "@shared/schema";
import { addJstDays, formatJstDate, getJstDayOfWeek, parseJstDate } from "@shared/jst";
import { transportDateSchema, transportNoticeSchema, transportProfileSchema } from "@shared/transport";
import { getCanonicalSlotStartDateTime } from "@shared/slotDateTime";

type Store = Pick<typeof db, "select" | "insert" | "update">;
type Profile = typeof transportProfiles.$inferSelect;
type Grants = Record<string, string>;
class TransportError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const fail = (status: number, message: string): never => { throw new TransportError(status, message); };
const normalizeName = (value: string) => value.normalize("NFKC").replace(/[\s\u3000]+/g, "");
const hashCode = (value: string) => createHash("sha256").update(value).digest("hex");
const publicProfile = ({ codeHash: _secret, createdAt: _created, ...profile }: Profile) => profile;
function grants(req: Request): Grants {
  const session = req.session as any;
  return session.transportUntil > Date.now() ? session.transportGrants || {} : {};
}
async function ownProfile(req: Request, id: string, store: Store = db, lock = false) {
  if (!Object.keys(grants(req)).length) fail(401, "送迎連絡コードを入力し直してください。");
  const query = store.select().from(transportProfiles).where(eq(transportProfiles.id, id));
  const [profile] = await (lock ? query.for("update") : query);
  if (!profile || !profile.active || grants(req)[id] !== profile.codeHash) fail(403, "このお子様の連絡コードを確認してください。停止中の場合はスクールへお問い合わせください。");
  return profile;
}
async function sessionProfiles(req: Request) {
  const all = Object.entries(grants(req));
  const profiles = await Promise.all(all.map(async ([id, hash]) => {
    const [profile] = await db.select().from(transportProfiles).where(eq(transportProfiles.id, id));
    return profile?.active && profile.codeHash === hash ? publicProfile(profile) : null;
  }));
  return profiles.filter(Boolean);
}
async function editingWindow(profile: Profile, day: string, store: Store = db) {
  const unavailable = { editable: false, deadlineAt: null, editingReason: "レッスン開始時刻を確認できません。スクールへお問い合わせください。" };
  const [course] = await store.select().from(courses).where(eq(courses.id, profile.courseId));
  if (!course || course.dayOfWeek.slice(0, 1) !== "日月火水木金土"[getJstDayOfWeek(parseJstDate(day))]) return unavailable;
  const slots = await store.select().from(classSlots).where(and(
    gte(classSlots.date, parseJstDate(day)), lt(classSlots.date, addJstDays(parseJstDate(day), 1)),
    eq(classSlots.startTime, course.startTime), eq(classSlots.classBand, profile.classBand),
  ));
  if (slots.length !== 1) return unavailable;
  const deadline = getCanonicalSlotStartDateTime(slots[0]);
  const editable = Date.now() < deadline.getTime();
  return { editable, deadlineAt: deadline.toISOString(), editingReason: editable ? null : "レッスン開始時刻を過ぎたため、入力・訂正・取消はできません。スクールへご連絡ください。" };
}
// Attendance is read-only. The live app has no authoritative member ID in its public absence flow.
// Match conservatively by normalized name + grade + the exact lesson, and fail closed on ambiguity.
async function eligibility(profile: Profile, day: string, store: Store = db) {
  const denied = (reason: string) => ({ eligible: false, reason, lessonTime: null });
  if (!profile.active) return denied("送迎対象の登録が無効です。スクールへ確認してください。");
  const [course] = await store.select().from(courses).where(eq(courses.id, profile.courseId));
  if (!course?.isActive) return denied("通常コースが確認できません。スクールへ確認してください。");
  const start = parseJstDate(day), end = addJstDays(start, 1);
  const name = normalizeName(profile.childName);
  const peers = await store.select().from(transportProfiles).where(and(
    eq(transportProfiles.classBand, profile.classBand), eq(transportProfiles.courseId, profile.courseId),
    eq(transportProfiles.active, true),
  ));
  if (peers.filter((peer) => normalizeName(peer.childName) === name).length > 1) {
    return denied("同名の登録があり出席予定を特定できません。スクールへ確認してください。");
  }
  const makeups = await store.select().from(requests).where(and(
    eq(requests.status, "確定"), eq(requests.declaredClassBand, profile.classBand),
    gte(requests.toSlotStartDateTime, start), lt(requests.toSlotStartDateTime, end),
  ));
  if (makeups.some((item) => normalizeName(item.childName) === name)) {
    return denied("振替日の送迎予定は通常と異なるため、スクールへ確認してください。");
  }
  if (course.dayOfWeek.slice(0, 1) !== "日月火水木金土"[getJstDayOfWeek(start)]) {
    return denied("通常のレッスン日ではありません。日付をご確認ください。");
  }
  const slots = await store.select().from(classSlots).where(and(
    gte(classSlots.date, start), lt(classSlots.date, end),
    eq(classSlots.startTime, course.startTime), eq(classSlots.classBand, profile.classBand),
  ));
  if (slots.length !== 1 || slots[0].isClosed) return denied("この日のレッスンは休講、または予定が未登録です。");
  const reports = await store.select().from(absences).where(and(
    gte(absences.absentDate, start), lt(absences.absentDate, end),
    eq(absences.declaredClassBand, profile.classBand),
  ));
  if (reports.some((item) => normalizeName(item.childName) === name && item.reportType === "ABSENCE"
    && !["CANCELLED", "EXPIRED"].includes(item.makeupStatus))) {
    return denied("この日は欠席連絡があります。出席予定を先に確認してください。");
  }
  return { eligible: true, reason: null, lessonTime: course.startTime };
}
const wrap = (handler: (req: Request, res: any) => Promise<unknown>): RequestHandler => async (req, res) => {
  try { await handler(req, res); }
  catch (error) {
    if (error instanceof ZodError) res.status(400).json({ error: error.issues[0]?.message || "入力をご確認ください。" });
    else if (error instanceof TransportError) res.status(error.status).json({ error: error.message });
    else { console.error("Transport operation failed", error instanceof Error ? error.name : "UnknownError"); res.status(500).json({ error: "送迎連絡を保存できませんでした。再読み込みしてご確認ください。" }); }
  }
};

export function registerTransportRoutes(app: Express, requireAdmin: RequestHandler, requireStaff: RequestHandler) {
  app.use(["/api/transport", "/api/admin/transport", "/api/staff/transport"], (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.method !== "GET") {
      if (!req.is("application/json")) { res.status(415).json({ error: "JSONで送信してください。" }); return; }
      const origin = req.get("origin");
      if (origin) {
        try { if (new URL(origin).host !== req.get("host")) throw new Error("origin"); }
        catch { res.status(403).json({ error: "別のサイトからは送信できません。" }); return; }
      }
    }
    next();
  });
  const accessLimiter = rateLimit({ windowMs: 15 * 60_000, max: 15, skipSuccessfulRequests: true,
    standardHeaders: true, legacyHeaders: false, message: { error: "しばらく待ってからコードを確認してください。" } });
  app.post("/api/transport/access", accessLimiter, wrap(async (req, res) => {
    const { code } = z.object({ code: z.string().trim().min(1).max(100) }).strict().parse(req.body);
    const [profile] = await db.select().from(transportProfiles).where(eq(transportProfiles.codeHash, hashCode(code)));
    if (!profile?.active) fail(403, "送迎連絡コードを確認してください。停止中の場合はスクールへお問い合わせください。");
    const current = grants(req);
    if (Object.keys(current).length >= 5 && !current[profile.id]) fail(400, "一度に確認できるお子様は5人までです。");
    const previous = req.session as any;
    const staffRole = previous.staffRole, isAdmin = previous.isAdmin;
    await new Promise<void>((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
    Object.assign(req.session, { staffRole, isAdmin, transportGrants: { ...current, [profile.id]: profile.codeHash }, transportUntil: Date.now() + 12 * 60 * 60_000 });
    await new Promise<void>((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    res.json({ profiles: await sessionProfiles(req), selectedId: profile.id });
  }));
  app.get("/api/transport/session", wrap(async (req, res) => res.json({ profiles: await sessionProfiles(req), today: formatJstDate(new Date()) })));
  app.post("/api/transport/logout", wrap(async (req, res) => {
    Object.assign(req.session, { transportGrants: {}, transportUntil: 0 });
    await new Promise<void>((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    res.json({ success: true });
  }));
  app.get("/api/transport/day", wrap(async (req, res) => {
    const { profileId, serviceDate } = z.object({ profileId: z.string(), serviceDate: transportDateSchema }).parse(req.query);
    const profile = await ownProfile(req, profileId);
    const [notice] = await db.select().from(transportNotices).where(and(eq(transportNotices.profileId, profileId), eq(transportNotices.serviceDate, serviceDate)));
    res.json({ ...await eligibility(profile, serviceDate), ...await editingWindow(profile, serviceDate), today: formatJstDate(new Date()), notice: notice || null });
  }));
  app.post("/api/transport/notices", wrap(async (req, res) => {
    const data = transportNoticeSchema.parse(req.body);
    if (data.serviceDate < formatJstDate(new Date())) fail(400, "過去の日付は変更できません（日本時間）。");
    const notice = await db.transaction(async (tx) => {
      // One lock per child also serializes simultaneous first submissions for the same date.
      const profile = await ownProfile(req, data.profileId, tx, true);
      const [old] = await tx.select().from(transportNotices).where(and(
        eq(transportNotices.profileId, data.profileId), eq(transportNotices.serviceDate, data.serviceDate),
      )).for("update");
      const window = await editingWindow(profile, data.serviceDate, tx);
      if (!window.editable) fail(400, window.editingReason!);
      if (old && old.direction === data.direction && old.note === data.note && old.status === data.status) return old;
      if ((old?.version || 0) !== data.expectedVersion) fail(409, "別の画面で変更されています。最新の連絡を読み込み直してください。");
      if (data.status === "ACTIVE") {
        const day = await eligibility(profile, data.serviceDate, tx);
        if (!day.eligible) fail(400, day.reason!);
        if ((data.direction !== "INBOUND" && !profile.outbound) || (data.direction !== "OUTBOUND" && !profile.inbound)) {
          fail(400, "普段利用していない便は選択できません。");
        }
      } else if (!old) fail(400, "取り消す連絡がありません。");
      const values = { direction: data.direction, note: data.note, status: data.status,
        version: (old?.version || 0) + 1, acknowledgedVersion: null, updatedAt: new Date() };
      const [saved] = old
        ? await tx.update(transportNotices).set(values).where(eq(transportNotices.id, old.id)).returning()
        : await tx.insert(transportNotices).values({ ...values, profileId: data.profileId, serviceDate: data.serviceDate }).returning();
      return saved;
    });
    res.json(notice);
  }));
  app.get("/api/admin/transport/profiles", requireAdmin, wrap(async (_req, res) => {
    res.json((await db.select().from(transportProfiles).orderBy(asc(transportProfiles.childName))).map(publicProfile));
  }));
  app.post("/api/admin/transport/profiles", requireAdmin, wrap(async (req, res) => {
    const data = transportProfileSchema.parse(req.body);
    const [course] = await db.select().from(courses).where(eq(courses.id, data.courseId));
    if (!course?.isActive) fail(400, "有効な通常コースを選択してください。");
    const code = randomBytes(18).toString("base64url");
    const [profile] = await db.insert(transportProfiles).values({ ...data, codeHash: hashCode(code) }).returning();
    res.json({ profile: publicProfile(profile), code });
  }));
  app.post("/api/admin/transport/profiles/:id/rotate-code", requireAdmin, wrap(async (req, res) => {
    const code = randomBytes(18).toString("base64url");
    const [profile] = await db.update(transportProfiles).set({ codeHash: hashCode(code), active: true })
      .where(eq(transportProfiles.id, req.params.id)).returning();
    if (!profile) fail(404, "対象の登録がありません。");
    res.json({ profile: publicProfile(profile), code });
  }));
  app.post("/api/admin/transport/profiles/:id/stop", requireAdmin, wrap(async (req, res) => {
    const profile = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(transportProfiles).where(eq(transportProfiles.id, req.params.id)).for("update");
      if (!current) fail(404, "対象の登録がありません。");
      if (!current.active) return current;
      const [stopped] = await tx.update(transportProfiles).set({ active: false }).where(eq(transportProfiles.id, current.id)).returning();
      // Keep every record, but require staff to recheck notices belonging to a stopped child.
      const notices = await tx.select().from(transportNotices).where(eq(transportNotices.profileId, current.id)).for("update");
      for (const notice of notices) await tx.update(transportNotices).set({ version: notice.version + 1, acknowledgedVersion: null, updatedAt: new Date() }).where(eq(transportNotices.id, notice.id));
      return stopped;
    });
    res.json(publicProfile(profile));
  }));
  const listNotices = wrap(async (req, res) => {
    const day = transportDateSchema.parse(req.query.date);
    const rows = await db.select().from(transportNotices).innerJoin(transportProfiles, eq(transportNotices.profileId, transportProfiles.id))
      .where(eq(transportNotices.serviceDate, day)).orderBy(asc(transportProfiles.childName));
    res.json(await Promise.all(rows.map(async ({ transport_notices: notice, transport_profiles: profile }) => {
      const attendance = await eligibility(profile, day);
      return { ...notice, childName: profile.childName, classBand: profile.classBand, lessonTime: attendance.lessonTime,
        attendanceWarning: notice.status === "ACTIVE" ? attendance.reason : null };
    })));
  });
  app.get("/api/admin/transport/notices", requireAdmin, listNotices);
  app.get("/api/staff/transport/notices", requireStaff, listNotices);
  app.post("/api/admin/transport/notices/:id/acknowledge", requireAdmin, wrap(async (req, res) => {
    const { version } = z.object({ version: z.number().int().positive() }).strict().parse(req.body);
    const [notice] = await db.update(transportNotices).set({ acknowledgedVersion: version })
      .where(and(eq(transportNotices.id, req.params.id), eq(transportNotices.version, version))).returning();
    if (!notice) fail(409, "連絡が変更されています。最新の内容を確認してください。");
    res.json(notice);
  }));
}
