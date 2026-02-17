import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { classSlots, absences, requests } from "@shared/schema";
import { eq, and, gte, lte, lt, asc, inArray, sql } from "drizzle-orm";
import {
  searchSlotsRequestSchema,
  bookRequestSchema,
  updateSlotCapacityRequestSchema,
  createSlotRequestSchema,
  updateSlotRequestSchema,
  deleteSlotRequestSchema,
  createAbsenceRequestSchema,
  createCourseRequestSchema,
  updateCourseRequestSchema,
} from "@shared/schema";
import { sendConfirmationEmail, sendExpiredEmail, sendAbsenceConfirmationEmail, sendMakeupConfirmationEmail, sendCancellationEmail, sendRequestCancellationEmail } from "./email-service";
import { createId } from "@paralleldrive/cuid2";
import { format, addDays } from "date-fns";
import { ja } from "date-fns/locale";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import {
  addJstDays,
  endOfJstDay,
  formatJstDate,
  getJstDayOfWeek,
  parseJstDate,
  parseJstDateTime,
  startOfJstDay,
} from "@shared/jst";
import { getActualCurrent, getRemainingCapacity, hasRemainingCapacity } from "@shared/capacity";

// Admin authentication middleware
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const sess = req.session as any;
  const isAdmin = sess?.isAdmin === true;
  const loginTime = sess?.adminLoginTime;

  // Session expires after 24 hours
  const sessionDuration = 24 * 60 * 60 * 1000;
  const isExpired = loginTime && (Date.now() - loginTime > sessionDuration);

  if (isAdmin && !isExpired) {
    next();
  } else {
    if (isExpired) {
      sess.isAdmin = false;
      sess.adminLoginTime = null;
    }
    res.status(401).json({ error: "認証が必要です" });
  }
}

// Generate a 6-digit confirmation code
function generateConfirmCode(): string {
  return Math.random().toString().slice(2, 8).padStart(6, '0');
}

function getCanonicalSlotStartDateTime(slot: { date: Date | string | number; startTime: string }): Date {
  return parseJstDateTime(formatJstDate(slot.date), slot.startTime);
}

async function getSlotAbsencesAndMakeups(slotId: string) {
  const slot = await storage.getClassSlotById(slotId);

  if (!slot) return null;

  const slotAbsences = await storage.getAbsencesByOriginalSlotId(slotId);
  const makeupRequests = await storage.getConfirmedRequestsBySlotId(slotId);

  return {
    slot,
    absences: slotAbsences,
    makeupRequests,
  };
}

const ABSENCE_CANCELLED_STATUSES = new Set(["CANCELLED", "EXPIRED"]);
const REQUEST_CANCELLED_STATUSES = new Set(["却下", "期限切れ", "キャンセル", "辞退"]);

function isAbsenceCancelledStatus(status: string | null | undefined): boolean {
  return !!status && ABSENCE_CANCELLED_STATUSES.has(status);
}

function isRequestCancelledStatus(status: string | null | undefined): boolean {
  return !!status && REQUEST_CANCELLED_STATUSES.has(status);
}

function isWithinAbsenceGracePeriod(absenceCreatedAt: Date | null | undefined): boolean {
  const createdAt = absenceCreatedAt || new Date();
  const now = new Date();
  return now.getTime() - createdAt.getTime() <= 10 * 60 * 1000;
}

type CancelAbsenceOptions = {
  enforceGraceRule: boolean;
};

type CancelAbsenceResult = {
  childName: string;
  alreadyCancelled: boolean;
};

async function cancelAbsenceWithRelated(absenceId: string, options: CancelAbsenceOptions): Promise<CancelAbsenceResult> {
  return db.transaction(async (tx) => {
    const [absence] = await tx.select().from(absences).where(eq(absences.id, absenceId));
    if (!absence) {
      throw new Error("NOT_FOUND_ABSENCE");
    }

    if (isAbsenceCancelledStatus(absence.makeupStatus)) {
      if (absence.makeupStatus !== "CANCELLED") {
        await tx
          .update(absences)
          .set({ makeupStatus: "CANCELLED", updatedAt: new Date() })
          .where(eq(absences.id, absence.id));
      }

      return {
        childName: absence.childName,
        alreadyCancelled: true,
      };
    }

    if (options.enforceGraceRule && !isWithinAbsenceGracePeriod(absence.createdAt)) {
      const [originalSlot] = await tx.select().from(classSlots).where(eq(classSlots.id, absence.originalSlotId));
      if (!originalSlot) {
        throw new Error("ORIGINAL_SLOT_NOT_FOUND");
      }
      if (!hasRemainingCapacity(originalSlot, 1)) {
        throw new Error("GRACE_RULE_BLOCKED");
      }
    }

    const [claimedAbsence] = await tx
      .update(absences)
      .set({
        makeupStatus: "CANCELLED",
        updatedAt: new Date(),
      })
      .where(and(
        eq(absences.id, absence.id),
        sql`${absences.makeupStatus} NOT IN ('CANCELLED', 'EXPIRED')`,
      ))
      .returning();

    if (!claimedAbsence) {
      return {
        childName: absence.childName,
        alreadyCancelled: true,
      };
    }

    const relatedRequests = await tx.select().from(requests).where(eq(requests.absenceId, absence.id));
    for (const request of relatedRequests) {
      if (request.status === "確定") {
        await tx
          .update(classSlots)
          .set({
            capacityMakeupUsed: sql`GREATEST(0, ${classSlots.capacityMakeupUsed} - 1)`,
            updatedAt: new Date(),
          })
          .where(eq(classSlots.id, request.toSlotId));

        await tx
          .update(requests)
          .set({
            status: "却下",
          })
          .where(eq(requests.id, request.id));
        continue;
      }

      if (request.status === "キャンセル" || request.status === "辞退") {
        await tx
          .update(requests)
          .set({
            status: "却下",
          })
          .where(eq(requests.id, request.id));
      }
    }

    await tx
      .update(classSlots)
      .set({
        capacityCurrent: sql`${classSlots.capacityCurrent} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(classSlots.id, absence.originalSlotId));

    return {
      childName: absence.childName,
      alreadyCancelled: false,
    };
  });
}

type CancelRequestResult = {
  request: typeof requests.$inferSelect;
  slot: typeof classSlots.$inferSelect | undefined;
  alreadyCancelled: boolean;
  wasConfirmed: boolean;
};

async function cancelRequestUnified(requestId: string): Promise<CancelRequestResult> {
  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(requests).where(eq(requests.id, requestId));
    if (!request) {
      throw new Error("NOT_FOUND_REQUEST");
    }

    const [slot] = await tx.select().from(classSlots).where(eq(classSlots.id, request.toSlotId));

    if (isRequestCancelledStatus(request.status)) {
      if (request.status !== "却下") {
        await tx
          .update(requests)
          .set({
            status: "却下",
          })
          .where(eq(requests.id, request.id));
      }

      return {
        request: { ...request, status: "却下" },
        slot,
        alreadyCancelled: true,
        wasConfirmed: false,
      };
    }

    const wasConfirmed = request.status === "確定";
    if (wasConfirmed) {
      await tx
        .update(classSlots)
        .set({
          capacityMakeupUsed: sql`GREATEST(0, ${classSlots.capacityMakeupUsed} - 1)`,
          updatedAt: new Date(),
        })
        .where(eq(classSlots.id, request.toSlotId));
    }

    await tx
      .update(requests)
      .set({
        status: "却下",
      })
      .where(eq(requests.id, request.id));

    if (wasConfirmed && request.absenceId) {
      const [absence] = await tx.select().from(absences).where(eq(absences.id, request.absenceId));
      if (absence && absence.makeupStatus === "MAKEUP_CONFIRMED") {
        await tx
          .update(absences)
          .set({ makeupStatus: "PENDING", updatedAt: new Date() })
          .where(eq(absences.id, absence.id));
      }
    }

    return {
      request: { ...request, status: "却下" },
      slot,
      alreadyCancelled: false,
      wasConfirmed,
    };
  });
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Validate session secret in production
  const sessionSecret = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production" && !sessionSecret) {
    console.error("⚠️ 本番環境ではSESSION_SECRET環境変数を設定してください。");
    throw new Error("SESSION_SECRET is required in production");
  }

  // Always set admin password from environment variable if it exists
  const envPassword = process.env.ADMIN_PASSWORD;
  if (envPassword) {
    const bcrypt = await import("bcryptjs");
    const salt = await bcrypt.default.genSalt(10);
    const hash = await bcrypt.default.hash(envPassword, salt);
    await storage.setAdminPasswordHash(hash);
    console.log("✅ 環境変数ADMIN_PASSWORDから管理者パスワードを設定しました。");
  } else {
    const adminPasswordHash = await storage.getAdminPasswordHash();
    if (!adminPasswordHash) {
      console.warn("⚠️ 管理者パスワードが設定されていません。");
      console.warn("   環境変数ADMIN_PASSWORDを設定するか、以下のコマンドで設定してください:");
      console.warn("   npx tsx set-admin-password.ts <password>");
    }
  }

  // Simple session setup for admin (no user auth needed)
  const PgSession = connectPgSimple(session);
  app.set("trust proxy", 1);
  app.use(
    session({
      store: new PgSession({
        conString: process.env.DATABASE_URL,
        tableName: "admin_sessions",
        createTableIfMissing: true,
      }),
      secret: sessionSecret || "hamasui-session-secret-2025",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    })
  );

  // Admin authentication endpoints
  app.post("/api/admin/login", async (req, res) => {
    const { password } = req.body;

    try {
      const adminPasswordHash = await storage.getAdminPasswordHash();

      if (!adminPasswordHash) {
        return res.status(500).json({ error: "管理者パスワードが設定されていません" });
      }

      const isMatch = await import("bcryptjs").then(b => b.default.compare(password, adminPasswordHash));

      if (isMatch) {
        (req.session as any).isAdmin = true;
        (req.session as any).adminLoginTime = Date.now();
        res.json({ success: true });
      } else {
        res.status(401).json({ error: "パスワードが正しくありません" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/check", (req, res) => {
    const session = req.session as any;
    const isAdmin = session?.isAdmin === true;
    const loginTime = session?.adminLoginTime;

    // Session expires after 24 hours
    const sessionDuration = 24 * 60 * 60 * 1000;
    const isExpired = loginTime && (Date.now() - loginTime > sessionDuration);

    if (isAdmin && !isExpired) {
      res.json({ authenticated: true });
    } else {
      if (isExpired) {
        session.isAdmin = false;
        session.adminLoginTime = null;
      }
      res.json({ authenticated: false });
    }
  });

  app.post("/api/admin/logout", (req, res) => {
    const session = req.session as any;
    session.isAdmin = false;
    session.adminLoginTime = null;
    res.json({ success: true });
  });

  // Lookup by confirm code (for parents to check their status)
  app.get("/api/lookup/:confirmCode", async (req, res) => {
    try {
      const { confirmCode } = req.params;

      if (!confirmCode || confirmCode.length !== 6) {
        return res.status(400).json({ error: "6桁の確認コードを入力してください" });
      }

      const userAbsences = await storage.getAbsencesByConfirmCode(confirmCode);
      const userRequests = await storage.getRequestsByConfirmCode(confirmCode);

      res.json({
        absences: userAbsences,
        requests: userRequests,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/courses", async (req, res) => {
    try {
      const courses = await storage.getActiveCourses();
      res.json(courses);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/courses", requireAdmin, async (req, res) => {
    try {
      const courses = await storage.getAllCourses();
      res.json(courses);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/courses", requireAdmin, async (req, res) => {
    try {
      const data = createCourseRequestSchema.parse(req.body);
      const course = await storage.createCourse({
        name: data.name,
        dayOfWeek: data.dayOfWeek,
        startTime: data.startTime,
        isActive: true,
      });
      res.json(course);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put("/api/admin/courses/:id", requireAdmin, async (req, res) => {
    try {
      const courseId = req.params.id;
      const data = updateCourseRequestSchema.parse({ ...req.body, id: courseId });

      const course = await storage.updateCourse(courseId, {
        name: data.name,
        dayOfWeek: data.dayOfWeek,
        startTime: data.startTime,
        isActive: data.isActive,
      });

      if (!course) {
        return res.status(404).json({ error: "コースが見つかりません" });
      }

      res.json(course);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/admin/courses/:id", requireAdmin, async (req, res) => {
    try {
      const courseId = req.params.id;
      const success = await storage.deleteCourse(courseId);

      if (!success) {
        return res.status(404).json({ error: "コースが見つかりません" });
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Cancel absence (欠席キャンセル) - GET info and POST action
  app.get("/api/cancel-absence/:token/info", async (req, res) => {
    try {
      const { token } = req.params;

      const absence = await storage.getAbsenceByResumeToken(token);
      if (!absence) {
        return res.status(404).json({ error: "無効なトークンです" });
      }

      if (isAbsenceCancelledStatus(absence.makeupStatus)) {
        return res.status(400).json({ error: "この欠席は既にキャンセルされています" });
      }

      const slot = absence.originalSlotId
        ? await storage.getClassSlotById(absence.originalSlotId)
        : null;

      res.json({
        childName: absence.childName,
        absentDate: format(absence.absentDate, "yyyy年M月d日"),
        classBand: absence.declaredClassBand,
        courseLabel: slot?.courseLabel,
        startTime: slot?.startTime,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/cancel-absence/:token", async (req, res) => {
    try {
      const { token } = req.params;

      const absence = await storage.getAbsenceByResumeToken(token);
      if (!absence) {
        return res.status(404).json({ error: "無効なトークンです" });
      }

      const result = await cancelAbsenceWithRelated(absence.id, { enforceGraceRule: true });

      res.json({
        success: true,
        message: result.alreadyCancelled ? "欠席連絡は既にキャンセル済みです。" : "欠席連絡をキャンセルしました",
        childName: result.childName,
        alreadyCancelled: result.alreadyCancelled,
      });
    } catch (error: any) {
      if (error.message === "GRACE_RULE_BLOCKED") {
        return res.status(400).json({
          error: "10分の猶予期間を過ぎているため、元のレッスン枠に空きがない場合はキャンセルできません",
        });
      }
      if (error.message === "ORIGINAL_SLOT_NOT_FOUND") {
        return res.status(400).json({ error: "元のレッスン枠が見つかりません。" });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Cancel absence by confirm code
  app.post("/api/cancel-absence-by-id/:absenceId", async (req, res) => {
    try {
      const absenceId = req.params.absenceId;
      const { confirmCode } = req.body;

      if (!confirmCode) {
        return res.status(400).json({ error: "確認コードが必要です" });
      }

      const absence = await storage.getAbsenceById(absenceId);

      if (!absence) {
        return res.status(404).json({ error: "欠席連絡が見つかりません。" });
      }

      if (absence.confirmCode !== confirmCode) {
        return res.status(403).json({ error: "確認コードが一致しません。" });
      }

      const result = await cancelAbsenceWithRelated(absence.id, { enforceGraceRule: true });

      res.json({
        success: true,
        message: result.alreadyCancelled ? "欠席連絡は既にキャンセル済みです。" : "欠席連絡をキャンセルしました。",
        alreadyCancelled: result.alreadyCancelled,
      });
    } catch (error: any) {
      if (error.message === "GRACE_RULE_BLOCKED") {
        return res.status(400).json({
          error: "欠席登録から10分以上経過しているため、元のレッスンに空きがない場合は欠席キャンセルできません。",
        });
      }
      if (error.message === "ORIGINAL_SLOT_NOT_FOUND") {
        return res.status(400).json({ error: "元のレッスン枠が見つかりません。" });
      }
      res.status(400).json({ error: error.message });
    }
  });

  // Cancel request by confirm code
  app.post("/api/cancel-request/:requestId", async (req, res) => {
    try {
      const requestId = req.params.requestId;
      const { confirmCode } = req.body;

      if (!confirmCode) {
        return res.status(400).json({ error: "確認コードが必要です" });
      }

      const request = await storage.getRequestById(requestId);

      if (!request) {
        return res.status(404).json({ error: "予約が見つかりません。" });
      }

      if (request.confirmCode !== confirmCode) {
        return res.status(403).json({ error: "確認コードが一致しません。" });
      }

      const result = await cancelRequestUnified(requestId);
      res.json({
        success: true,
        message: result.alreadyCancelled ? "予約は既にキャンセル済みです。" : "予約をキャンセルしました。",
        alreadyCancelled: result.alreadyCancelled,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/admin/lesson-status", requireAdmin, async (req, res) => {
    try {
      const { slotId } = req.query;

      if (!slotId || typeof slotId !== 'string') {
        return res.status(400).json({ message: "slotIdが必要です" });
      }

      const result = await getSlotAbsencesAndMakeups(slotId);

      if (!result) {
        return res.status(404).json({ message: "レッスン枠が見つかりません" });
      }

      res.json(result);
    } catch (error: any) {
      console.error("レッスン状況取得エラー:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/daily-lessons", requireAdmin, async (req, res) => {
    try {
      const { date } = req.query;

      if (!date || typeof date !== 'string') {
        return res.status(400).json({ message: "dateが必要です" });
      }

      const targetDate = parseJstDate(date);
      const slots = await storage.getClassSlotsByDate(targetDate);

      const lessonsWithStatus = await Promise.all(
        slots.map(async (slot) => {
          const status = await getSlotAbsencesAndMakeups(slot.id);
          return {
            ...slot,
            absenceCount: status?.absences.length || 0,
            makeupCount: status?.makeupRequests.length || 0,
          };
        })
      );

      res.json(lessonsWithStatus);
    } catch (error: any) {
      console.error("日別レッスン取得エラー:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/confirmed", requireAdmin, async (req, res) => {
    try {
      const allConfirmed = await storage.getConfirmedRequests();
      const filtered = allConfirmed.filter(r => r.contactEmail === null);
      res.json(filtered);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Get all absences for history view
  app.get("/api/admin/absences", requireAdmin, async (req, res) => {
    try {
      const allAbsences = await storage.getAllAbsences();

      // Enrich with slot info
      const enrichedAbsences = await Promise.all(
        allAbsences.map(async (absence) => {
          const slot = await storage.getClassSlotById(absence.originalSlotId);
          return {
            ...absence,
            courseLabel: slot?.courseLabel || null,
            startTime: slot?.startTime || null,
          };
        })
      );

      res.json(enrichedAbsences);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Get all requests for history view
  app.get("/api/admin/requests", requireAdmin, async (req, res) => {
    try {
      const allRequests = await db.select().from(requests).orderBy(asc(requests.createdAt));

      // Enrich with slot info
      const enrichedRequests = await Promise.all(
        allRequests.map(async (request) => {
          const slot = await storage.getClassSlotById(request.toSlotId);
          return {
            ...request,
            courseLabel: slot?.courseLabel || null,
            toSlotDate: slot?.date || null,
            toSlotStartTime: slot?.startTime || null,
          };
        })
      );

      res.json(enrichedRequests);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Dashboard stats
  app.get("/api/admin/dashboard-stats", requireAdmin, async (req, res) => {
    try {
      const today = startOfJstDay(new Date());

      // Get today's slots
      const todaySlots = await storage.getClassSlotsByDate(today);

      // Count today's absences and makeups
      let todayAbsences = 0;
      let todayMakeups = 0;

      for (const slot of todaySlots) {
        const slotAbsences = await storage.getAbsencesByOriginalSlotId(slot.id);
        const slotMakeups = await storage.getConfirmedRequestsBySlotId(slot.id);
        todayAbsences += slotAbsences.length;
        todayMakeups += slotMakeups.length;
      }

      // Get total pending absences (makeup not yet confirmed)
      const allAbsences = await storage.getAllAbsences();
      const pendingAbsences = allAbsences.filter(a => a.makeupStatus === "PENDING").length;

      // Get future slots count
      const futureSlots = await storage.countFutureSlots();

      res.json({
        todayAbsences,
        todayMakeups,
        pendingAbsences,
        futureSlots,
        todayLessons: todaySlots.length,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Daily status - get absences and makeups for a specific date
  app.get("/api/admin/daily-status", requireAdmin, async (req, res) => {
    try {
      const { date } = req.query;

      // Use today's date if not specified
      const targetDate = date && typeof date === 'string'
        ? new Date(date + "T00:00:00")
        : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();

      // Get all slots for the target date
      const slots = await storage.getClassSlotsByDate(targetDate);

      // Collect absences (students absent from this date's lessons)
      const absentees: Array<{
        childName: string;
        courseLabel: string;
        classBand: string;
        startTime: string;
      }> = [];

      // Collect makeups (students transferring TO this date's lessons)
      const makeups: Array<{
        childName: string;
        courseLabel: string;
        classBand: string;
        startTime: string;
      }> = [];

      for (const slot of slots) {
        // Get absences for this slot
        const slotAbsences = await storage.getAbsencesByOriginalSlotId(slot.id);
        for (const absence of slotAbsences) {
          absentees.push({
            childName: absence.childName,
            courseLabel: slot.courseLabel,
            classBand: slot.classBand,
            startTime: slot.startTime,
          });
        }

        // Get confirmed makeup requests for this slot
        const slotMakeups = await storage.getConfirmedRequestsBySlotId(slot.id);
        for (const request of slotMakeups) {
          makeups.push({
            childName: request.childName,
            courseLabel: slot.courseLabel,
            classBand: slot.classBand,
            startTime: slot.startTime,
          });
        }
      }

      // Sort by startTime, then by childName
      const sortFn = (a: any, b: any) => {
        const timeCompare = a.startTime.localeCompare(b.startTime);
        if (timeCompare !== 0) return timeCompare;
        return a.childName.localeCompare(b.childName);
      };

      absentees.sort(sortFn);
      makeups.sort(sortFn);

      res.json({
        date: format(targetDate, "yyyy-MM-dd"),
        absentees,
        makeups,
      });
    } catch (error: any) {
      console.error("Daily status error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Cancel absence (with slot capacity update)
  app.post("/api/admin/cancel-absence/:id", requireAdmin, async (req, res) => {
    try {
      const absenceId = req.params.id;

      const absence = await storage.getAbsenceById(absenceId);
      if (!absence) {
        return res.status(404).json({ error: "欠席連絡が見つかりません" });
      }

      const result = await cancelAbsenceWithRelated(absence.id, { enforceGraceRule: true });

      res.json({
        success: true,
        message: result.alreadyCancelled ? "欠席連絡は既にキャンセル済みです。" : "欠席連絡をキャンセルしました",
        childName: result.childName,
        alreadyCancelled: result.alreadyCancelled,
      });
    } catch (error: any) {
      if (error.message === "GRACE_RULE_BLOCKED") {
        return res.status(400).json({
          error: "欠席登録から10分以上経過しているため、元のレッスンに空きがない場合は欠席キャンセルできません。",
        });
      }
      if (error.message === "ORIGINAL_SLOT_NOT_FOUND") {
        return res.status(400).json({ error: "元のレッスン枠が見つかりません。" });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Cancel request (with slot capacity update)
  app.post("/api/admin/cancel-request/:id", requireAdmin, async (req, res) => {
    try {
      const requestId = req.params.id;

      const request = await storage.getRequestById(requestId);
      if (!request) {
        return res.status(404).json({ error: "振替予約が見つかりません" });
      }

      const result = await cancelRequestUnified(requestId);

      res.json({
        success: true,
        message: result.alreadyCancelled ? "振替予約は既にキャンセル済みです。" : "振替予約をキャンセルしました",
        childName: result.request.childName,
        alreadyCancelled: result.alreadyCancelled,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/check-slots-availability", async (req, res) => {
    try {
      const slotCount = await storage.countFutureSlots();
      res.json({ hasSlots: slotCount > 0, count: slotCount });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/class-slots", async (req, res) => {
    try {
      const { date, classBand } = req.query;

      if (!date || typeof date !== 'string') {
        return res.status(400).json({ error: "日付を指定してください。" });
      }

      if (!classBand || typeof classBand !== 'string') {
        return res.status(400).json({ error: "クラス帯を指定してください。" });
      }

      const targetDate = parseJstDate(date);
      const slots = await storage.getClassSlotsByDateAndClassBand(targetDate, classBand);

      const now = new Date();
      res.json({
        success: true,
        slots: slots.map(slot => {
          const canonicalSlotStartDateTime = getCanonicalSlotStartDateTime(slot);
          return {
            id: slot.id,
            date: formatJstDate(slot.date),
            startTime: slot.startTime,
            courseLabel: slot.courseLabel,
            classBand: slot.classBand,
            lessonStartDateTime: canonicalSlotStartDateTime.toISOString(),
            isPastLesson: canonicalSlotStartDateTime <= now,
          };
        })
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/absences", async (req, res) => {
    try {
      const data = createAbsenceRequestSchema.parse(req.body);
      const absentDate = parseJstDate(data.absentDateISO);

      const originalSlot = await storage.getClassSlotById(data.originalSlotId);
      if (!originalSlot) {
        return res.status(400).json({
          error: "指定されたレッスン枠が見つかりません。"
        });
      }

      const slotDateStr = formatJstDate(originalSlot.date);
      if (slotDateStr !== data.absentDateISO) {
        return res.status(400).json({
          error: "選択したレッスン枠の日付が欠席日と一致しません。"
        });
      }

      if (originalSlot.classBand !== data.declaredClassBand) {
        return res.status(400).json({
          error: "選択したレッスン枠のクラス帯が一致しません。"
        });
      }

      // Check if lesson time has already passed (fraud prevention)
      const now = new Date();
      const originalSlotStartDateTime = getCanonicalSlotStartDateTime(originalSlot);
      if (originalSlotStartDateTime <= now) {
        return res.status(400).json({
          error: "レッスン開始時刻を過ぎているため、欠席連絡を登録できません。"
        });
      }

      const slotCount = await storage.countFutureSlots();
      if (slotCount === 0) {
        console.warn("⚠️ 振替可能なレッスン枠が登録されていません。欠席登録は受け付けますが、振替予約はできません。");
      }

      const settings = await storage.getGlobalSettings();
      const makeupWindowDays = settings?.makeupWindowDays || 30;

      const makeupDeadline = addJstDays(absentDate, makeupWindowDays);

      const resumeToken = createId();
      const absenceId = createId();
      const confirmCode = generateConfirmCode();

      const absence = await storage.createAbsence({
        id: absenceId,
        userId: null,
        childId: data.childId || null,
        childName: data.childName,
        declaredClassBand: data.declaredClassBand,
        absentDate: absentDate,
        originalSlotId: data.originalSlotId,
        contactEmail: data.contactEmail || null,
        resumeToken: resumeToken,
        confirmCode: confirmCode,
        makeupDeadline: makeupDeadline,
        makeupStatus: "PENDING",
      });

      await storage.decrementClassSlotCurrent(data.originalSlotId);

      if (data.contactEmail) {
        try {
          await sendAbsenceConfirmationEmail(
            data.contactEmail,
            data.childName,
            data.declaredClassBand,
            format(absentDate, "yyyy年M月d日"),
            format(makeupDeadline, "yyyy年M月d日"),
            resumeToken,
            absence.id,
            originalSlot.courseLabel,
            originalSlot.startTime,
            confirmCode
          );
        } catch (error: any) {
          console.error("欠席確認メール送信エラー:", error.message);
        }
      }

      res.json({
        success: true,
        absenceId: absence.id,
        resumeToken: resumeToken,
        confirmCode: confirmCode,
        makeupDeadline: formatJstDate(makeupDeadline),
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/absences/:token", async (req, res) => {
    try {
      const token = req.params.token;
      const absence = await storage.getAbsenceByResumeToken(token);

      if (!absence) {
        return res.status(404).json({ error: "欠席連絡が見つかりません。" });
      }

      res.json({
        id: absence.id,
        childName: absence.childName,
        declaredClassBand: absence.declaredClassBand,
        absentDate: formatJstDate(absence.absentDate),
        originalSlotId: absence.originalSlotId,
        contactEmail: absence.contactEmail,
        makeupDeadline: formatJstDate(absence.makeupDeadline),
        makeupStatus: absence.makeupStatus,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/cancel-absence", async (req, res) => {
    try {
      const resumeToken = req.body.resumeToken;

      if (!resumeToken) {
        return res.status(400).json({ error: "resumeTokenが必要です。" });
      }

      const absence = await storage.getAbsenceByResumeToken(resumeToken);

      if (!absence) {
        return res.status(404).json({ error: "欠席連絡が見つかりません。" });
      }

      const result = await cancelAbsenceWithRelated(absence.id, { enforceGraceRule: true });

      if (!result.alreadyCancelled && absence.contactEmail) {
        try {
          await sendCancellationEmail(
            absence.contactEmail,
            absence.childName,
            format(absence.absentDate, "yyyy年M月d日")
          );
        } catch (error) {
          console.error("キャンセルメール送信エラー:", error);
        }
      }

      res.json({
        success: true,
        message: result.alreadyCancelled ? "欠席連絡は既にキャンセル済みです。" : "欠席連絡をキャンセルしました。",
        childName: result.childName,
        alreadyCancelled: result.alreadyCancelled,
      });
    } catch (error: any) {
      if (error.message === "GRACE_RULE_BLOCKED") {
        return res.status(400).json({
          error: "欠席登録から10分以上経過しているため、元のレッスンに空きがない場合は欠席キャンセルできません。",
        });
      }
      if (error.message === "ORIGINAL_SLOT_NOT_FOUND") {
        return res.status(400).json({ error: "元のレッスン枠が見つかりません。" });
      }
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/search-slots", async (req, res) => {
    try {
      const data = searchSlotsRequestSchema.parse(req.body);

      const settings = await storage.getGlobalSettings();
      const makeupWindowDays = settings?.makeupWindowDays || 30;

      const absentDate = parseJstDate(data.absentDateISO);
      const startRange = addJstDays(absentDate, -makeupWindowDays);
      const endRange = endOfJstDay(addJstDays(absentDate, makeupWindowDays));

      const allSlots = await storage.getClassSlotsByDateRange(startRange, endRange);
      const now = new Date();

      const slots = allSlots.filter(slot => {
        const canonicalSlotStartDateTime = getCanonicalSlotStartDateTime(slot);
        return slot.classBand === data.declaredClassBand && canonicalSlotStartDateTime >= now;
      });

      const results = slots.map(slot => {
        const remainingSlots = getRemainingCapacity(slot);
        const actualCurrent = getActualCurrent(slot);
        let statusCode: "〇" | "△" | "×";
        let statusText: string;

        if (remainingSlots >= 2) {
          statusCode = "〇";
          statusText = `振替可能（残り${remainingSlots}枠）`;
        } else if (remainingSlots === 1) {
          statusCode = "△";
          statusText = "残席わずか（残り1枠）";
        } else {
          statusCode = "×";
          statusText = "満席";
        }

        return {
          slotId: slot.id,
          date: formatJstDate(slot.date),
          startTime: slot.startTime,
          courseLabel: slot.courseLabel,
          classBand: slot.classBand,
          statusCode,
          statusText,
          remainingSlots,
          capacityLimit: slot.capacityLimit,
          capacityCurrent: slot.capacityCurrent,
          capacityMakeupUsed: slot.capacityMakeupUsed || 0,
          actualCurrent,
        };
      });

      res.json(results);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/book", async (req, res) => {
    try {
      const data = bookRequestSchema.parse(req.body);

      const now = new Date();
      const cancelToken = createId();
      const requestId = createId();
      const bookingResult = await db.transaction(async (tx) => {
        const [slot] = await tx.select().from(classSlots).where(eq(classSlots.id, data.toSlotId));
        if (!slot) {
          throw new Error("BOOK_SLOT_NOT_FOUND");
        }

        if (slot.classBand !== data.declaredClassBand) {
          throw new Error("BOOK_CLASS_BAND_MISMATCH");
        }

        const slotStartDateTime = getCanonicalSlotStartDateTime(slot);
        if (slotStartDateTime <= now) {
          throw new Error("BOOK_SLOT_STARTED");
        }

        if (!hasRemainingCapacity(slot, 1)) {
          throw new Error("BOOK_SLOT_FULL");
        }

        const existingRequests = await tx.select().from(requests).where(eq(requests.toSlotId, data.toSlotId));
        const duplicateRequest = existingRequests.find(
          r => r.status === "確定" && r.childName === data.childName
        );
        if (duplicateRequest) {
          throw new Error("BOOK_DUPLICATE_CHILD");
        }

        let confirmCode: string | null = null;
        let txContactEmail: string | null = null;
        let claimedAbsenceId: string | null = null;
        if (data.absenceId) {
          const [absence] = await tx.select().from(absences).where(eq(absences.id, data.absenceId));
          if (!absence) {
            throw new Error("BOOK_ABSENCE_NOT_FOUND");
          }
          if (isAbsenceCancelledStatus(absence.makeupStatus)) {
            throw new Error("BOOK_ABSENCE_CANCELLED");
          }
          if (absence.makeupStatus !== "PENDING") {
            throw new Error("BOOK_ABSENCE_NOT_PENDING");
          }
          if (endOfJstDay(absence.makeupDeadline) < now) {
            throw new Error("BOOK_ABSENCE_DEADLINE");
          }

          const alreadyConfirmed = await tx.select().from(requests).where(and(
            eq(requests.absenceId, absence.id),
            eq(requests.status, "確定"),
          ));
          if (alreadyConfirmed.length > 0) {
            throw new Error("BOOK_ABSENCE_ALREADY_CONFIRMED");
          }

          const [claimedAbsence] = await tx
            .update(absences)
            .set({
              makeupStatus: "MAKEUP_CONFIRMED",
              updatedAt: new Date(),
            })
            .where(and(
              eq(absences.id, absence.id),
              eq(absences.makeupStatus, "PENDING"),
            ))
            .returning();
          if (!claimedAbsence) {
            throw new Error("BOOK_ABSENCE_NOT_PENDING");
          }

          claimedAbsenceId = claimedAbsence.id;
          txContactEmail = claimedAbsence.contactEmail;
          confirmCode = claimedAbsence.confirmCode;
        }

        const [updatedSlot] = await tx
          .update(classSlots)
          .set({
            capacityMakeupUsed: sql`${classSlots.capacityMakeupUsed} + 1`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(classSlots.id, data.toSlotId),
            sql`${classSlots.capacityLimit} - ${classSlots.capacityCurrent} - ${classSlots.capacityMakeupUsed} >= 1`,
          ))
          .returning();
        if (!updatedSlot) {
          throw new Error("BOOK_SLOT_FULL");
        }

        const [request] = await tx.insert(requests).values({
          id: requestId,
          userId: null,
          childId: data.childId || null,
          absenceId: claimedAbsenceId || data.absenceId || null,
          childName: data.childName,
          declaredClassBand: data.declaredClassBand,
          absentDate: parseJstDate(data.absentDateISO),
          toSlotId: data.toSlotId,
          status: "確定",
          contactEmail: txContactEmail,
          confirmToken: null,
          declineToken: null,
          cancelToken,
          confirmCode,
          toSlotStartDateTime: slotStartDateTime,
        }).returning();

        return {
          contactEmail: txContactEmail,
          slotForEmail: {
            courseLabel: updatedSlot.courseLabel,
            date: updatedSlot.date,
            startTime: updatedSlot.startTime,
            classBand: updatedSlot.classBand,
          },
          requestIdForEmail: request.id,
        };
      });

      if (bookingResult.contactEmail) {
        try {
          await sendMakeupConfirmationEmail(
            bookingResult.contactEmail,
            data.childName,
            bookingResult.slotForEmail.courseLabel,
            format(bookingResult.slotForEmail.date, "yyyy年M月d日(E)", { locale: ja }),
            bookingResult.slotForEmail.startTime,
            bookingResult.slotForEmail.classBand,
            bookingResult.requestIdForEmail,
            cancelToken,
          );
        } catch (error: any) {
          console.error("振替確定メール送信エラー:", error.message);
        }
      }

      res.json({ success: true, status: "確定", message: "振替予約が成立しました。" });
    } catch (error: any) {
      if (error.message === "BOOK_SLOT_NOT_FOUND") {
        return res.status(404).json({ success: false, message: "指定された枠が見つかりません。" });
      }
      if (error.message === "BOOK_CLASS_BAND_MISMATCH") {
        return res.status(400).json({ success: false, message: "クラス帯が一致しません。" });
      }
      if (error.message === "BOOK_SLOT_STARTED") {
        return res.status(400).json({ success: false, message: "この枠は開始時刻を過ぎているため予約できません。" });
      }
      if (error.message === "BOOK_SLOT_FULL") {
        return res.status(400).json({ success: false, message: "この枠は満席のため予約できません。" });
      }
      if (error.message === "BOOK_DUPLICATE_CHILD") {
        return res.status(400).json({
          success: false,
          message: "同じお子様は既にこの枠に登録済みです。重複して登録することはできません。",
        });
      }
      if (error.message === "BOOK_ABSENCE_NOT_FOUND") {
        return res.status(400).json({ success: false, message: "欠席情報が見つかりません。" });
      }
      if (error.message === "BOOK_ABSENCE_CANCELLED") {
        return res.status(400).json({ success: false, message: "キャンセル済みの欠席連絡では予約できません。" });
      }
      if (error.message === "BOOK_ABSENCE_NOT_PENDING") {
        return res.status(400).json({ success: false, message: "この欠席連絡は現在予約可能な状態ではありません。" });
      }
      if (error.message === "BOOK_ABSENCE_DEADLINE") {
        return res.status(400).json({ success: false, message: "振替期限が過ぎているため予約できません。" });
      }
      if (error.message === "BOOK_ABSENCE_ALREADY_CONFIRMED") {
        return res.status(400).json({ success: false, message: "この欠席連絡は既に振替予約が確定しています。" });
      }
      res.status(400).json({ error: error.message });
    }
  });


  app.post("/admin/update-slot-capacity", async (req, res) => {
    try {
      const data = updateSlotCapacityRequestSchema.parse(req.body);

      const slot = await storage.getClassSlotById(data.slotId);
      if (!slot) {
        return res.status(404).json({ error: "指定された枠が見つかりません。" });
      }

      const updateData: any = {};
      if (data.capacityCurrent !== undefined) updateData.capacityCurrent = data.capacityCurrent;
      if (data.capacityMakeupUsed !== undefined) updateData.capacityMakeupUsed = data.capacityMakeupUsed;

      await storage.updateClassSlot(data.slotId, updateData);

      res.json({ success: true, message: "枠容量を更新しました。" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/cancel", async (req, res) => {
    try {
      const requestId = req.query.requestId as string;
      const token = req.query.token as string;

      if (!requestId || !token) {
        return res.status(400).json({ error: "無効なリクエストです" });
      }

      const request = await storage.getRequestById(requestId);

      if (!request) {
        return res.status(404).json({ error: "リクエストが見つかりません" });
      }

      if (request.cancelToken !== token) {
        return res.status(403).json({ error: "無効なキャンセルトークンです" });
      }

      const statusText = "振替予約";

      const result = await cancelRequestUnified(requestId);
      const slot = result.slot;

      if (!result.alreadyCancelled && request.contactEmail && slot) {
        try {
          await sendRequestCancellationEmail(
            request.contactEmail,
            request.childName,
            slot.courseLabel,
            format(slot.date, "yyyy年M月d日(E)", { locale: ja }),
            slot.startTime,
            request.status,
          );
        } catch (error) {
          console.error("キャンセルメール送信エラー:", error);
        }
      }

      res.json({
        success: true,
        message: result.alreadyCancelled ? `${statusText}は既にキャンセル済みです` : `${statusText}をキャンセルしました`,
        childName: request.childName,
        statusText: statusText,
        wasConfirmed: result.wasConfirmed,
        alreadyCancelled: result.alreadyCancelled,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "エラーが発生しました" });
    }
  });

  app.get("/api/wait-decline", async (req, res) => {
    const renderPage = (title: string, message: string, isSuccess: boolean) => {
      return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans JP', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
      padding: 40px;
      max-width: 500px;
      text-align: center;
    }
    .icon {
      font-size: 48px;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 24px;
      color: #333;
      margin-bottom: 15px;
    }
    p {
      color: #666;
      line-height: 1.6;
      margin-bottom: 30px;
    }
    .button {
      display: inline-block;
      padding: 12px 30px;
      background: #667eea;
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 500;
      transition: background 0.3s;
      border: none;
      cursor: pointer;
      font-size: 16px;
    }
    .button:hover {
      background: #5568d3;
    }
    .success .icon { color: #4caf50; }
    .success h1 { color: #2e7d32; }
    .error .icon { color: #f44336; }
    .error h1 { color: #c62828; }
  </style>
</head>
<body>
  <div class="container ${isSuccess ? 'success' : 'error'}">
    <div class="icon">${isSuccess ? '✓' : '✕'}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <button class="button" onclick="window.history.back()">戻る</button>
  </div>
</body>
</html>`;
    };

    try {
      const token = req.query.token as string;
      if (!token) {
        return res.status(400).send(renderPage(
          "無効なリクエスト",
          "リンクが正しくない、または期限切れの可能性があります。",
          false
        ));
      }

      const allRequests = await db.select().from(requests).where(eq(requests.declineToken, token));
      const request = allRequests[0];

      if (!request) {
        return res.status(404).send(renderPage(
          "リクエストが見つかりません",
          "このリンクで指定されたリクエストが見つかりません。",
          false
        ));
      }

      if (request.status !== "確定" && !isRequestCancelledStatus(request.status)) {
        return res.status(400).send(renderPage(
          "既に処理されています",
          "このリクエストは既に処理されています。",
          false
        ));
      }

      const result = await cancelRequestUnified(request.id);
      if (result.alreadyCancelled) {
        return res.status(400).send(renderPage(
          "既に処理されています",
          "このリクエストは既に処理されています。",
          false
        ));
      }

      res.send(renderPage(
        "辞退が完了しました",
        `${request.childName}さんの振替予約を辞退しました。ご利用ありがとうございました。`,
        true
      ));
    } catch (error: any) {
      res.status(500).send(renderPage(
        "エラーが発生しました",
        `予期しないエラーが発生しました。${error.message || "もう一度お試しください。"}`,
        false
      ));
    }
  });

  app.post("/api/cancel-request", async (req, res) => {
    try {
      const { requestId, cancelToken } = req.body;

      const request = await storage.getRequestById(requestId);

      if (!request) {
        return res.status(404).json({ error: "リクエストが見つかりません。" });
      }

      if (request.cancelToken !== cancelToken) {
        return res.status(403).json({ error: "無効なキャンセルトークンです。" });
      }

      const result = await cancelRequestUnified(requestId);

      if (!result.alreadyCancelled && request.contactEmail && result.slot) {
        try {
          await sendRequestCancellationEmail(
            request.contactEmail,
            request.childName,
            result.slot.courseLabel,
            format(result.slot.date, "yyyy年M月d日(E)", { locale: ja }),
            result.slot.startTime,
            request.status,
          );
        } catch (error) {
          console.error("キャンセルメール送信エラー:", error);
        }
      }

      res.json({
        success: true,
        message: result.alreadyCancelled ? "予約は既にキャンセル済みです。" : "予約をキャンセルしました。",
        alreadyCancelled: result.alreadyCancelled,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });


  app.get("/api/admin/slots", requireAdmin, async (req, res) => {
    try {
      const slots = await db.select().from(classSlots).orderBy(asc(classSlots.date), asc(classSlots.startTime));
      res.json(slots);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/create-slot", requireAdmin, async (req, res) => {
    try {
      const data = createSlotRequestSchema.parse(req.body);
      const createdSlots = [];

      if (data.isRecurring && data.recurringWeeks) {
        const startDate = parseJstDate(data.date);

        for (let week = 0; week < data.recurringWeeks; week++) {
          const currentDate = addDays(startDate, week * 7);

          const dateStr = formatJstDate(currentDate);

          for (const classBand of data.classBands) {
            const dateTime = parseJstDateTime(dateStr, data.startTime);
            const slotId = `${dateStr}_${data.startTime}_${classBand === "初級" ? "shokyu" : classBand === "中級" ? "chukyu" : "jokyu"}`;

            const existing = await storage.getClassSlotById(slotId);
            if (existing) {
              continue;
            }

            const bandCapacity = data.classBandCapacities[classBand] || {
              capacityLimit: 10,
              capacityCurrent: 0,
            };

            const slot = await storage.createClassSlot({
              id: slotId,
              date: currentDate,
              startTime: data.startTime,
              courseLabel: data.courseLabel,
              classBand: classBand,
              capacityLimit: bandCapacity.capacityLimit,
              capacityCurrent: bandCapacity.capacityCurrent,
              capacityMakeupUsed: 0,
              waitlistCount: 0,
              lessonStartDateTime: dateTime,
              lastNotifiedRequestId: null,
            });

            createdSlots.push(slot);
          }
        }

        res.json({
          success: true,
          count: createdSlots.length,
          message: `${createdSlots.length}個の枠を作成しました`,
          slots: createdSlots
        });
      } else {
        const slotDate = parseJstDate(data.date);
        const dateStr = formatJstDate(slotDate);
        
        for (const classBand of data.classBands) {
          const dateTime = parseJstDateTime(dateStr, data.startTime);
          const slotId = `${dateStr}_${data.startTime}_${classBand === "初級" ? "shokyu" : classBand === "中級" ? "chukyu" : "jokyu"}`;

          const existing = await storage.getClassSlotById(slotId);
          if (existing) {
            continue;
          }

          const bandCapacity = data.classBandCapacities[classBand] || {
            capacityLimit: 10,
            capacityCurrent: 0,
          };

          const slot = await storage.createClassSlot({
            id: slotId,
            date: slotDate,
            startTime: data.startTime,
            courseLabel: data.courseLabel,
            classBand: classBand,
            capacityLimit: bandCapacity.capacityLimit,
            capacityCurrent: bandCapacity.capacityCurrent,
            capacityMakeupUsed: 0,
            waitlistCount: 0,
            lessonStartDateTime: dateTime,
            lastNotifiedRequestId: null,
          });

          createdSlots.push(slot);
        }

        res.json({
          success: true,
          count: createdSlots.length,
          message: `${createdSlots.length}個の枠を作成しました`,
          slots: createdSlots
        });
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put("/api/admin/update-slot", requireAdmin, async (req, res) => {
    try {
      const data = updateSlotRequestSchema.parse(req.body);

      const existing = await storage.getClassSlotById(data.id);
      if (!existing) {
        return res.status(404).json({ error: "指定された枠が見つかりません。" });
      }

      const updateData: any = {};
      if (data.date) updateData.date = parseJstDate(data.date);
      if (data.startTime) updateData.startTime = data.startTime;
      if (data.courseLabel) updateData.courseLabel = data.courseLabel;
      if (data.classBand) updateData.classBand = data.classBand;
      if (data.capacityLimit !== undefined) updateData.capacityLimit = data.capacityLimit;
      if (data.capacityCurrent !== undefined) updateData.capacityCurrent = data.capacityCurrent;

      if (data.date && data.startTime) {
        updateData.lessonStartDateTime = parseJstDateTime(data.date, data.startTime);
      } else if (data.date) {
        updateData.lessonStartDateTime = parseJstDateTime(data.date, existing.startTime);
      } else if (data.startTime) {
        const dateStr = formatJstDate(existing.date);
        updateData.lessonStartDateTime = parseJstDateTime(dateStr, data.startTime);
      }

      if (data.applyToFuture) {
        const currentDate = existing.date;
        const dayOfWeek = getJstDayOfWeek(currentDate);

        const allSlots = await db.select().from(classSlots)
          .where(and(
            eq(classSlots.startTime, existing.startTime),
            eq(classSlots.classBand, existing.classBand),
            eq(classSlots.courseLabel, existing.courseLabel),
            gte(classSlots.date, currentDate)
          ));

        const sameDaySlots = allSlots.filter(slot => getJstDayOfWeek(slot.date) === dayOfWeek);

        let updatedCount = 0;
        for (const slot of sameDaySlots) {
          const slotUpdateData: any = {};
          if (data.capacityLimit !== undefined) slotUpdateData.capacityLimit = data.capacityLimit;
          if (data.capacityCurrent !== undefined) slotUpdateData.capacityCurrent = data.capacityCurrent;
          if (data.courseLabel) slotUpdateData.courseLabel = data.courseLabel;

          if (Object.keys(slotUpdateData).length > 0) {
            await storage.updateClassSlot(slot.id, slotUpdateData);
            updatedCount++;
          }
        }

        res.json({
          success: true,
          message: `${updatedCount}個の枠を更新しました`,
          count: updatedCount,
        });
      } else {
        const updated = await storage.updateClassSlot(data.id, updateData);
        res.json({ success: true, slot: updated });
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/admin/delete-slot", requireAdmin, async (req, res) => {
    try {
      const data = deleteSlotRequestSchema.parse(req.body);

      const existing = await storage.getClassSlotById(data.id);
      if (!existing) {
        return res.status(404).json({ error: "指定された枠が見つかりません。" });
      }

      const slotAbsences = await storage.getAbsencesByOriginalSlotId(data.id);
      if (slotAbsences.length > 0) {
        return res.status(400).json({
          error: "この枠には欠席登録があるため削除できません。先に欠席登録を削除してください。"
        });
      }

      const slotRequests = await storage.getRequestsBySlotId(data.id);
      for (const request of slotRequests) {
        await storage.deleteRequest(request.id);
      }

      await storage.deleteClassSlot(data.id);

      res.json({ success: true, message: "枠を削除しました。", deletedRequests: slotRequests.length });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/admin/delete-slots-bulk", requireAdmin, async (req, res) => {
    try {
      const { slotIds } = req.body;
      if (!Array.isArray(slotIds)) {
        return res.status(400).json({ error: "slotIdsは配列である必要があります。" });
      }

      let deletedCount = 0;
      let skippedCount = 0;
      for (const slotId of slotIds) {
        const existing = await storage.getClassSlotById(slotId);
        if (!existing) continue;

        const slotAbsences = await storage.getAbsencesByOriginalSlotId(slotId);
        if (slotAbsences.length > 0) {
          skippedCount++;
          continue;
        }

        const slotRequests = await storage.getRequestsBySlotId(slotId);
        for (const request of slotRequests) {
          await storage.deleteRequest(request.id);
        }

        await storage.deleteClassSlot(slotId);
        deletedCount++;
      }

      if (skippedCount > 0 && deletedCount === 0) {
        return res.status(400).json({
          error: `選択した${skippedCount}件の枠には欠席登録があるため削除できませんでした。`
        });
      }

      res.json({ success: true, count: deletedCount, skipped: skippedCount });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/admin/delete-slots-by-date", requireAdmin, async (req, res) => {
    try {
      const { date } = req.body;
      if (!date) {
        return res.status(400).json({ error: "dateは必須です。" });
      }

      const allSlots = await storage.getAllClassSlots();
      const slotsOnDate = allSlots.filter(slot => {
        const slotDate = formatJstDate(slot.date);
        return slotDate === date;
      });

      let deletedCount = 0;
      let skippedCount = 0;
      for (const slot of slotsOnDate) {
        const slotAbsences = await storage.getAbsencesByOriginalSlotId(slot.id);
        if (slotAbsences.length > 0) {
          skippedCount++;
          continue;
        }

        const slotRequests = await storage.getRequestsBySlotId(slot.id);
        for (const request of slotRequests) {
          await storage.deleteRequest(request.id);
        }

        await storage.deleteClassSlot(slot.id);
        deletedCount++;
      }

      if (skippedCount > 0 && deletedCount === 0) {
        return res.status(400).json({
          error: `この日の${skippedCount}件の枠には欠席登録があるため削除できませんでした。`
        });
      }

      res.json({ success: true, count: deletedCount, skipped: skippedCount });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/settings", async (req, res) => {
    try {
      const settings = await storage.getGlobalSettings();
      res.json(settings || { id: 1, makeupWindowDays: 30, cutoffTime: "16:00" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/settings", async (req, res) => {
    try {
      const { makeupWindowDays, cutoffTime } = req.body;
      const settings = await storage.updateGlobalSettings({ makeupWindowDays, cutoffTime });
      res.json(settings);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/holidays", async (req, res) => {
    try {
      const allHolidays = await storage.getAllHolidays();
      res.json(allHolidays);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/holidays", async (req, res) => {
    try {
      const { date, name } = req.body;
      const holiday = await storage.createHoliday({ date: parseJstDate(date), name });
      res.json(holiday);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/holidays/:id", async (req, res) => {
    try {
      const holidayId = req.params.id;
      const success = await storage.deleteHoliday(holidayId);

      if (!success) {
        return res.status(404).json({ error: "休館日が見つかりません" });
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // New RESTful token-based endpoints

  // Decline (辞退) - GET info and POST action
  app.get("/api/decline/:token/info", async (req, res) => {
    try {
      const { token } = req.params;

      const request = await storage.getRequestByDeclineToken(token);
      if (!request) {
        return res.status(404).json({ error: "無効なトークンです" });
      }

      if (request.status !== "確定") {
        return res.status(400).json({ error: "この予約は既に処理されています" });
      }

      const slot = await storage.getClassSlotById(request.toSlotId);
      if (!slot) {
        return res.status(404).json({ error: "振替枠が見つかりません" });
      }

      res.json({
        childName: request.childName,
        date: format(slot.date, "yyyy年M月d日(E)", { locale: ja }),
        startTime: slot.startTime,
        courseLabel: slot.courseLabel,
        classBand: slot.classBand,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/decline/:token", async (req, res) => {
    try {
      const { token } = req.params;

      const request = await storage.getRequestByDeclineToken(token);
      if (!request) {
        return res.status(404).json({ error: "無効なトークンです" });
      }

      const result = await cancelRequestUnified(request.id);

      res.json({
        success: true,
        message: result.alreadyCancelled ? "この予約は既に処理されています" : "振替予約を辞退しました",
        alreadyCancelled: result.alreadyCancelled,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Cancel request (振替予約キャンセル) - GET info and POST action
  app.get("/api/cancel/:token/info", async (req, res) => {
    try {
      const { token } = req.params;

      const request = await storage.getRequestByCancelToken(token);
      if (!request) {
        return res.status(404).json({ error: "無効なトークンです" });
      }

      if (request.status !== "確定") {
        return res.status(400).json({ error: "この予約は既に処理されています" });
      }

      const slot = await storage.getClassSlotById(request.toSlotId);
      if (!slot) {
        return res.status(404).json({ error: "振替枠が見つかりません" });
      }

      res.json({
        childName: request.childName,
        date: format(slot.date, "yyyy年M月d日(E)", { locale: ja }),
        startTime: slot.startTime,
        courseLabel: slot.courseLabel,
        classBand: slot.classBand,
        status: request.status,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/cancel/:token", async (req, res) => {
    try {
      const { token } = req.params;

      const request = await storage.getRequestByCancelToken(token);
      if (!request) {
        return res.status(404).json({ error: "無効なトークンです" });
      }

      const result = await cancelRequestUnified(request.id);

      res.json({
        success: true,
        message: result.alreadyCancelled ? "振替予約は既にキャンセル済みです。" : "振替予約をキャンセルしました",
        childName: request.childName,
        alreadyCancelled: result.alreadyCancelled,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
