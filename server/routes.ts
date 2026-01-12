import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { classSlots, absences, requests } from "@shared/schema";
import { eq, and, gte, lte, lt, asc, inArray } from "drizzle-orm";
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

// Generate a 6-digit confirmation code
function generateConfirmCode(): string {
  return Math.random().toString().slice(2, 8).padStart(6, '0');
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

export async function registerRoutes(app: Express): Promise<Server> {
  // Simple session setup for admin (no user auth needed)
  const PgSession = connectPgSimple(session);
  app.set("trust proxy", 1);
  app.use(
    session({
      store: new PgSession({
        conString: process.env.DATABASE_URL,
        tableName: "admin_sessions",
        createTableIfMissing: false,
      }),
      secret: process.env.SESSION_SECRET || "hamasui-session-secret-2025",
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
  app.post("/api/admin/login", (req, res) => {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
      return res.status(500).json({ error: "管理者パスワードが設定されていません" });
    }

    if (password === adminPassword) {
      (req.session as any).isAdmin = true;
      (req.session as any).adminLoginTime = Date.now();
      res.json({ success: true });
    } else {
      res.status(401).json({ error: "パスワードが正しくありません" });
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

  app.get("/api/admin/courses", async (req, res) => {
    try {
      const courses = await storage.getAllCourses();
      res.json(courses);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/courses", async (req, res) => {
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

  app.put("/api/admin/courses/:id", async (req, res) => {
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

  app.delete("/api/admin/courses/:id", async (req, res) => {
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

      if (absence.makeupStatus === "CANCELLED") {
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

      if (absence.makeupStatus === "CANCELLED") {
        return res.status(400).json({ error: "この欠席は既にキャンセルされています" });
      }

      const now = new Date();
      const createdAt = absence.createdAt || new Date();
      const timeSinceCreation = now.getTime() - createdAt.getTime();
      const gracePeriod = 10 * 60 * 1000; // 10 minutes

      if (timeSinceCreation > gracePeriod) {
        if (absence.originalSlotId) {
          const slot = await storage.getClassSlotById(absence.originalSlotId);
          if (slot) {
            const remainingSlots = (slot.capacityLimit - slot.capacityCurrent) - (slot.capacityMakeupUsed || 0);
            if (remainingSlots < 1) {
              return res.status(400).json({
                error: "10分の猶予期間を過ぎているため、元のレッスン枠に空きがない場合はキャンセルできません"
              });
            }
          }
        }
      }

      const relatedRequests = await storage.getRequestsByAbsenceId(absence.id);

      for (const request of relatedRequests) {
        if (request.status === "確定") {
          await storage.updateRequest(request.id, {
            status: "キャンセル",
            cancelToken: null,
            declineToken: null,
          });

          const slot = await storage.getClassSlotById(request.toSlotId);
          if (slot) {
            await storage.updateClassSlot(request.toSlotId, {
              capacityMakeupUsed: Math.max(0, (slot.capacityMakeupUsed || 0) - 1),
            });
          }
        }
      }

      if (absence.originalSlotId) {
        const slot = await storage.getClassSlotById(absence.originalSlotId);
        if (slot) {
          await storage.updateClassSlot(absence.originalSlotId, {
            capacityCurrent: Math.max(0, slot.capacityCurrent - 1),
          });
        }
      }

      await storage.updateAbsence(absence.id, {
        makeupStatus: "CANCELLED",
      });

      res.json({
        success: true,
        message: "欠席連絡をキャンセルしました",
        childName: absence.childName,
      });
    } catch (error: any) {
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

      if (absence.makeupStatus === "EXPIRED") {
        return res.status(400).json({ error: "キャンセル済みの欠席連絡は再度キャンセルできません。" });
      }

      const now = new Date();
      const tenMinutesAfterCreation = new Date(absence.createdAt!);
      tenMinutesAfterCreation.setMinutes(tenMinutesAfterCreation.getMinutes() + 10);
      const isWithin10Minutes = now <= tenMinutesAfterCreation;

      if (!isWithin10Minutes) {
        const originalSlot = await storage.getClassSlotById(absence.originalSlotId);

        if (!originalSlot) {
          return res.status(400).json({
            error: "元のレッスン枠が見つかりません。",
          });
        }

        const originalSlotAvailable = originalSlot.capacityCurrent < originalSlot.capacityLimit;

        if (!originalSlotAvailable) {
          return res.status(400).json({
            error: "欠席登録から10分以上経過しているため、元のレッスンに空きがない場合は欠席キャンセルできません。",
          });
        }
      }

      // 関連する振替予約をすべてキャンセル
      const relatedRequests = await storage.getRequestsByAbsenceId(absence.id);
      const activeRequests = relatedRequests.filter(r => r.status === "確定");

      for (const request of activeRequests) {
        const slot = await storage.getClassSlotById(request.toSlotId);
        if (!slot) continue;

        await storage.updateClassSlot(request.toSlotId, {
          capacityMakeupUsed: Math.max(0, (slot.capacityMakeupUsed || 0) - 1),
        });

        await storage.updateRequest(request.id, { status: "却下" });
      }

      // 元のレッスン枠に戻す
      const originalSlot = await storage.getClassSlotById(absence.originalSlotId);
      if (originalSlot) {
        await storage.updateClassSlot(absence.originalSlotId, {
          capacityCurrent: originalSlot.capacityCurrent + 1,
        });
      }

      await storage.updateAbsence(absence.id, { makeupStatus: "EXPIRED" });

      res.json({ success: true, message: "欠席連絡をキャンセルしました。" });
    } catch (error: any) {
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

      if (request.status === "却下" || request.status === "期限切れ") {
        return res.status(400).json({ error: "この予約は既にキャンセル済みです。" });
      }

      await storage.updateRequest(requestId, { status: "却下" });

      const slot = await storage.getClassSlotById(request.toSlotId);

      if (request.status === "確定" && slot) {
        await storage.updateClassSlot(request.toSlotId, {
          capacityMakeupUsed: Math.max(0, (slot.capacityMakeupUsed || 0) - 1),
        });

        if (request.absenceId) {
          await storage.updateAbsence(request.absenceId, { makeupStatus: "PENDING" });
        }
      }

      res.json({ success: true, message: "予約をキャンセルしました。" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/admin/lesson-status", async (req, res) => {
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

  app.get("/api/admin/daily-lessons", async (req, res) => {
    try {
      const { date } = req.query;

      if (!date || typeof date !== 'string') {
        return res.status(400).json({ message: "dateが必要です" });
      }

      const targetDate = new Date(date);
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

  app.get("/api/admin/confirmed", async (req, res) => {
    try {
      const allConfirmed = await storage.getConfirmedRequests();
      const filtered = allConfirmed.filter(r => r.contactEmail === null);
      res.json(filtered);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Get all absences for history view
  app.get("/api/admin/absences", async (req, res) => {
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
  app.get("/api/admin/requests", async (req, res) => {
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
  app.get("/api/admin/dashboard-stats", async (req, res) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

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

  // Admin: Cancel absence (with slot capacity update)
  app.post("/api/admin/cancel-absence/:id", async (req, res) => {
    try {
      const absenceId = req.params.id;

      const absence = await storage.getAbsenceById(absenceId);
      if (!absence) {
        return res.status(404).json({ error: "欠席連絡が見つかりません" });
      }

      if (absence.makeupStatus === "EXPIRED" || absence.makeupStatus === "CANCELLED") {
        return res.status(400).json({ error: "この欠席は既にキャンセル済みです" });
      }

      // Cancel related requests
      const relatedRequests = await storage.getRequestsByAbsenceId(absence.id);
      for (const request of relatedRequests) {
        if (request.status === "確定") {
          const slot = await storage.getClassSlotById(request.toSlotId);
          if (slot) {
            await storage.updateClassSlot(request.toSlotId, {
              capacityMakeupUsed: Math.max(0, (slot.capacityMakeupUsed || 0) - 1),
            });
          }
          await storage.updateRequest(request.id, { status: "却下" });
        }
      }

      // Restore original slot capacity
      const originalSlot = await storage.getClassSlotById(absence.originalSlotId);
      if (originalSlot) {
        await storage.updateClassSlot(absence.originalSlotId, {
          capacityCurrent: originalSlot.capacityCurrent + 1,
        });
      }

      // Mark absence as expired
      await storage.updateAbsence(absenceId, { makeupStatus: "EXPIRED" });

      res.json({
        success: true,
        message: "欠席連絡をキャンセルしました",
        childName: absence.childName
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Cancel request (with slot capacity update)
  app.post("/api/admin/cancel-request/:id", async (req, res) => {
    try {
      const requestId = req.params.id;

      const request = await storage.getRequestById(requestId);
      if (!request) {
        return res.status(404).json({ error: "振替予約が見つかりません" });
      }

      if (request.status === "却下" || request.status === "期限切れ") {
        return res.status(400).json({ error: "この予約は既にキャンセル済みです" });
      }

      // Update slot capacity if it was confirmed
      if (request.status === "確定") {
        const slot = await storage.getClassSlotById(request.toSlotId);
        if (slot) {
          await storage.updateClassSlot(request.toSlotId, {
            capacityMakeupUsed: Math.max(0, (slot.capacityMakeupUsed || 0) - 1),
          });
        }

        // Reset absence status to PENDING if exists
        if (request.absenceId) {
          await storage.updateAbsence(request.absenceId, { makeupStatus: "PENDING" });
        }
      }

      await storage.updateRequest(requestId, { status: "却下" });

      res.json({
        success: true,
        message: "振替予約をキャンセルしました",
        childName: request.childName
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

      const targetDate = new Date(date);
      const slots = await storage.getClassSlotsByDateAndClassBand(targetDate, classBand);

      const now = new Date();
      res.json({
        success: true,
        slots: slots.map(slot => ({
          id: slot.id,
          date: format(slot.date, "yyyy-MM-dd"),
          startTime: slot.startTime,
          courseLabel: slot.courseLabel,
          classBand: slot.classBand,
          lessonStartDateTime: slot.lessonStartDateTime?.toISOString() || null,
          isPastLesson: slot.lessonStartDateTime ? new Date(slot.lessonStartDateTime) <= now : false,
        }))
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/absences", async (req, res) => {
    try {
      const data = createAbsenceRequestSchema.parse(req.body);
      const absentDate = new Date(data.absentDateISO);

      const originalSlot = await storage.getClassSlotById(data.originalSlotId);
      if (!originalSlot) {
        return res.status(400).json({
          error: "指定されたレッスン枠が見つかりません。"
        });
      }

      const slotDateStr = format(originalSlot.date, "yyyy-MM-dd");
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
      if (originalSlot.lessonStartDateTime && new Date(originalSlot.lessonStartDateTime) <= now) {
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

      const makeupDeadline = new Date(absentDate);
      makeupDeadline.setDate(makeupDeadline.getDate() + makeupWindowDays);

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

      await storage.updateClassSlot(data.originalSlotId, {
        capacityCurrent: originalSlot.capacityCurrent - 1,
      });

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
        makeupDeadline: format(makeupDeadline, "yyyy-MM-dd"),
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
        absentDate: format(absence.absentDate, "yyyy-MM-dd"),
        originalSlotId: absence.originalSlotId,
        contactEmail: absence.contactEmail,
        makeupDeadline: format(absence.makeupDeadline, "yyyy-MM-dd"),
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

      if (absence.makeupStatus === "EXPIRED") {
        return res.status(400).json({ error: "キャンセル済みの欠席連絡は再度キャンセルできません。" });
      }

      const now = new Date();
      const tenMinutesAfterCreation = new Date(absence.createdAt!);
      tenMinutesAfterCreation.setMinutes(tenMinutesAfterCreation.getMinutes() + 10);
      const isWithin10Minutes = now <= tenMinutesAfterCreation;

      if (!isWithin10Minutes) {
        const originalSlot = await storage.getClassSlotById(absence.originalSlotId);

        if (!originalSlot) {
          return res.status(400).json({
            error: "元のレッスン枠が見つかりません。",
          });
        }

        const originalSlotAvailable = originalSlot.capacityCurrent < originalSlot.capacityLimit;

        if (!originalSlotAvailable) {
          return res.status(400).json({
            error: "欠席登録から10分以上経過しているため、元のレッスンに空きがない場合は欠席キャンセルできません。",
          });
        }
      }

      const relatedRequests = await storage.getRequestsByAbsenceId(absence.id);
      const activeRequests = relatedRequests.filter(r => r.status === "確定");

      for (const request of activeRequests) {
        const slot = await storage.getClassSlotById(request.toSlotId);
        if (!slot) continue;

        await storage.updateClassSlot(request.toSlotId, {
          capacityMakeupUsed: Math.max(0, (slot.capacityMakeupUsed || 0) - 1),
        });

        await storage.updateRequest(request.id, { status: "却下" });
      }

      const originalSlot = await storage.getClassSlotById(absence.originalSlotId);
      if (originalSlot) {
        await storage.updateClassSlot(absence.originalSlotId, {
          capacityCurrent: originalSlot.capacityCurrent + 1,
        });
      }

      await storage.updateAbsence(absence.id, { makeupStatus: "EXPIRED" });

      if (absence.contactEmail) {
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
        message: "欠席連絡をキャンセルしました。",
        childName: absence.childName
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/search-slots", async (req, res) => {
    try {
      const data = searchSlotsRequestSchema.parse(req.body);

      const settings = await storage.getGlobalSettings();
      const makeupWindowDays = settings?.makeupWindowDays || 30;

      const absentDate = new Date(data.absentDateISO);
      const startRange = new Date(absentDate);
      startRange.setDate(startRange.getDate() - makeupWindowDays);
      const endRange = new Date(absentDate);
      endRange.setDate(endRange.getDate() + makeupWindowDays);

      const allSlots = await storage.getClassSlotsByDateRange(startRange, endRange);
      const now = new Date();

      const slots = allSlots.filter(slot =>
        slot.classBand === data.declaredClassBand &&
        slot.lessonStartDateTime >= now
      );

      const results = slots.map(slot => {
        const remainingSlots = (slot.capacityLimit - slot.capacityCurrent) - (slot.capacityMakeupUsed || 0);
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
          date: format(slot.date, "yyyy-MM-dd"),
          startTime: slot.startTime,
          courseLabel: slot.courseLabel,
          classBand: slot.classBand,
          statusCode,
          statusText,
          remainingSlots,
          capacityLimit: slot.capacityLimit,
          capacityCurrent: slot.capacityCurrent,
          capacityMakeupUsed: slot.capacityMakeupUsed || 0,
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

      const slot = await storage.getClassSlotById(data.toSlotId);
      if (!slot) {
        return res.status(404).json({ success: false, message: "指定された枠が見つかりません。" });
      }

      if (slot.classBand !== data.declaredClassBand) {
        return res.status(400).json({ success: false, message: "クラス帯が一致しません。" });
      }

      const remainingSlots = (slot.capacityLimit - slot.capacityCurrent) - (slot.capacityMakeupUsed || 0);
      if (remainingSlots < 1) {
        return res.status(400).json({ success: false, message: "この枠は満席のため予約できません。" });
      }

      // Check for duplicate registration by same person for same slot
      const existingRequests = await storage.getRequestsBySlotId(data.toSlotId);
      const duplicateRequest = existingRequests.find(
        r => r.status === "確定" && r.childName === data.childName
      );
      if (duplicateRequest) {
        return res.status(400).json({
          success: false,
          message: "同じお子様は既にこの枠に登録済みです。重複して登録することはできません。"
        });
      }

      let contactEmail: string | null = null;
      let confirmCode: string | null = null;

      if (data.absenceId) {
        const absence = await storage.getAbsenceById(data.absenceId);
        if (absence) {
          contactEmail = absence.contactEmail;
          confirmCode = absence.confirmCode;
          await storage.updateAbsence(data.absenceId, { makeupStatus: "MAKEUP_CONFIRMED" });
        }
      }

      const cancelToken = createId();
      const requestId = createId();

      const request = await storage.createRequest({
        id: requestId,
        userId: null,
        childId: data.childId || null,
        absenceId: data.absenceId || null,
        childName: data.childName,
        declaredClassBand: data.declaredClassBand,
        absentDate: new Date(data.absentDateISO),
        toSlotId: data.toSlotId,
        status: "確定",
        contactEmail: contactEmail,
        confirmToken: null,
        declineToken: null,
        cancelToken: cancelToken,
        confirmCode: confirmCode,
        toSlotStartDateTime: slot.lessonStartDateTime,
      });

      await storage.updateClassSlot(data.toSlotId, {
        capacityMakeupUsed: (slot.capacityMakeupUsed || 0) + 1,
      });

      if (contactEmail) {
        try {
          await sendMakeupConfirmationEmail(
            contactEmail,
            data.childName,
            slot.courseLabel,
            format(slot.date, "yyyy年M月d日(E)", { locale: ja }),
            slot.startTime,
            slot.classBand,
            request.id,
            cancelToken
          );
        } catch (error: any) {
          console.error("振替確定メール送信エラー:", error.message);
        }
      }

      res.json({ success: true, status: "確定", message: "振替予約が成立しました。" });
    } catch (error: any) {
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

      const oldRemainingSlots = (slot.capacityLimit - slot.capacityCurrent) - (slot.capacityMakeupUsed || 0);

      const updateData: any = {};
      if (data.capacityCurrent !== undefined) updateData.capacityCurrent = data.capacityCurrent;
      if (data.capacityMakeupUsed !== undefined) updateData.capacityMakeupUsed = data.capacityMakeupUsed;

      await storage.updateClassSlot(data.slotId, updateData);

      const updatedSlot = await storage.getClassSlotById(data.slotId);
      if (updatedSlot) {
        const newRemainingSlots = (updatedSlot.capacityLimit - updatedSlot.capacityCurrent) - (updatedSlot.capacityMakeupUsed || 0);
      }

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

      if (request.status === "却下" || request.status === "期限切れ") {
        return res.status(400).json({ error: "このリクエストは既にキャンセル済みです" });
      }

      const slot = await storage.getClassSlotById(request.toSlotId);

      const statusText = "振替予約";

      await storage.updateRequest(requestId, { status: "却下" });

      if (request.status === "確定" && slot) {
        await storage.updateClassSlot(request.toSlotId, {
          capacityMakeupUsed: Math.max(0, (slot.capacityMakeupUsed || 0) - 1),
        });

        if (request.absenceId) {
          await storage.updateAbsence(request.absenceId, { makeupStatus: "PENDING" });
        }
      }

      if (request.contactEmail && slot) {
        try {
          await sendRequestCancellationEmail(
            request.contactEmail,
            request.childName,
            slot.courseLabel,
            format(slot.date, "yyyy年M月d日(E)", { locale: ja }),
            slot.startTime,
            request.status
          );
        } catch (error) {
          console.error("キャンセルメール送信エラー:", error);
        }
      }

      res.json({
        success: true,
        message: `${statusText}をキャンセルしました`,
        childName: request.childName,
        statusText: statusText,
        wasConfirmed: request.status === "確定"
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

      if (request.status !== "確定") {
        return res.status(400).send(renderPage(
          "既に処理されています",
          "このリクエストは既に処理されています。",
          false
        ));
      }

      await storage.updateRequest(request.id, { status: "却下" });

      const slot = await storage.getClassSlotById(request.toSlotId);
      if (slot) {
        await storage.updateClassSlot(request.toSlotId, {
          capacityMakeupUsed: Math.max(0, (slot.capacityMakeupUsed || 0) - 1),
        });
      }


      if (request.absenceId) {
        await storage.updateAbsence(request.absenceId, { makeupStatus: "PENDING" });
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

      if (request.status === "却下" || request.status === "期限切れ") {
        return res.status(400).json({ error: "このリクエストは既にキャンセル済みです。" });
      }

      await storage.updateRequest(requestId, { status: "却下" });

      const slot = await storage.getClassSlotById(request.toSlotId);

      if (request.status === "確定" && slot) {
        await storage.updateClassSlot(request.toSlotId, {
          capacityMakeupUsed: Math.max(0, (slot.capacityMakeupUsed || 0) - 1),
        });

        if (request.absenceId) {
          await storage.updateAbsence(request.absenceId, { makeupStatus: "PENDING" });
        }
      }

      if (request.contactEmail && slot) {
        try {
          await sendRequestCancellationEmail(
            request.contactEmail,
            request.childName,
            slot.courseLabel,
            format(slot.date, "yyyy年M月d日(E)", { locale: ja }),
            slot.startTime,
            request.status
          );
        } catch (error) {
          console.error("キャンセルメール送信エラー:", error);
        }
      }

      res.json({ success: true, message: "予約をキャンセルしました。" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });


  app.get("/api/admin/slots", async (req, res) => {
    try {
      const slots = await db.select().from(classSlots).orderBy(asc(classSlots.lessonStartDateTime));
      res.json(slots);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/create-slot", async (req, res) => {
    try {
      const data = createSlotRequestSchema.parse(req.body);
      const createdSlots = [];

      if (data.isRecurring && data.recurringWeeks) {
        const startDate = new Date(data.date);

        for (let week = 0; week < data.recurringWeeks; week++) {
          const currentDate = new Date(startDate);
          currentDate.setDate(startDate.getDate() + (week * 7));

          const dateStr = currentDate.toISOString().split('T')[0];

          for (const classBand of data.classBands) {
            const dateTime = new Date(`${dateStr}T${data.startTime}:00+09:00`);
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
        for (const classBand of data.classBands) {
          const dateTime = new Date(`${data.date}T${data.startTime}:00+09:00`);
          const slotId = `${data.date}_${data.startTime}_${classBand === "初級" ? "shokyu" : classBand === "中級" ? "chukyu" : "jokyu"}`;

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
            date: new Date(data.date),
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

  app.put("/api/admin/update-slot", async (req, res) => {
    try {
      const data = updateSlotRequestSchema.parse(req.body);

      const existing = await storage.getClassSlotById(data.id);
      if (!existing) {
        return res.status(404).json({ error: "指定された枠が見つかりません。" });
      }

      const updateData: any = {};
      if (data.date) updateData.date = new Date(data.date);
      if (data.startTime) updateData.startTime = data.startTime;
      if (data.courseLabel) updateData.courseLabel = data.courseLabel;
      if (data.classBand) updateData.classBand = data.classBand;
      if (data.capacityLimit !== undefined) updateData.capacityLimit = data.capacityLimit;
      if (data.capacityCurrent !== undefined) updateData.capacityCurrent = data.capacityCurrent;

      if (data.date && data.startTime) {
        updateData.lessonStartDateTime = new Date(`${data.date}T${data.startTime}:00+09:00`);
      } else if (data.date) {
        updateData.lessonStartDateTime = new Date(`${data.date}T${existing.startTime}:00+09:00`);
      } else if (data.startTime) {
        const dateStr = existing.date.toISOString().split('T')[0];
        updateData.lessonStartDateTime = new Date(`${dateStr}T${data.startTime}:00+09:00`);
      }

      if (data.applyToFuture) {
        const currentDate = existing.date;
        const dayOfWeek = currentDate.getDay();

        const allSlots = await db.select().from(classSlots)
          .where(and(
            eq(classSlots.startTime, existing.startTime),
            eq(classSlots.classBand, existing.classBand),
            eq(classSlots.courseLabel, existing.courseLabel),
            gte(classSlots.date, currentDate)
          ));

        const sameDaySlots = allSlots.filter(slot => slot.date.getDay() === dayOfWeek);

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

  app.post("/api/admin/delete-slot", async (req, res) => {
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

  app.post("/api/admin/delete-slots-bulk", async (req, res) => {
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

  app.post("/api/admin/delete-slots-by-date", async (req, res) => {
    try {
      const { date } = req.body;
      if (!date) {
        return res.status(400).json({ error: "dateは必須です。" });
      }

      const allSlots = await storage.getAllClassSlots();
      const slotsOnDate = allSlots.filter(slot => {
        const slotDate = new Date(slot.date).toISOString().split('T')[0];
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

  app.get("/api/admin/absences", async (req, res) => {
    try {
      const allAbsences = await storage.getAllAbsences();
      res.json(allAbsences);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
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
      const holiday = await storage.createHoliday({ date: new Date(date), name });
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

      if (request.status !== "確定") {
        return res.status(400).json({ error: "この予約は既に処理されています" });
      }

      await storage.updateRequest(request.id, {
        status: "辞退",
        declineToken: null,
      });

      const slot = await storage.getClassSlotById(request.toSlotId);
      if (slot) {
        await storage.updateClassSlot(request.toSlotId, {
          capacityMakeupUsed: Math.max(0, (slot.capacityMakeupUsed || 0) - 1),
        });
      }

      if (request.absenceId) {
        await storage.updateAbsence(request.absenceId, {
          makeupStatus: "PENDING",
        });
      }

      res.json({
        success: true,
        message: "振替予約を辞退しました",
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

      if (request.status !== "確定") {
        return res.status(400).json({ error: "この予約は既に処理されています" });
      }

      await storage.updateRequest(request.id, {
        status: "キャンセル",
        cancelToken: null,
      });

      const slot = await storage.getClassSlotById(request.toSlotId);
      if (slot) {
        await storage.updateClassSlot(request.toSlotId, {
          capacityMakeupUsed: Math.max(0, (slot.capacityMakeupUsed || 0) - 1),
        });
      }

      if (request.absenceId) {
        await storage.updateAbsence(request.absenceId, {
          makeupStatus: "PENDING",
        });
      }

      res.json({
        success: true,
        message: "振替予約をキャンセルしました",
        childName: request.childName,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
