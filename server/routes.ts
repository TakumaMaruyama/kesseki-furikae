import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { classSlots, absences, requests, trialParticipants, closureEvents, closureEventSlots } from "@shared/schema";
import { eq, and, gte, lte, lt, asc, desc, inArray, sql } from "drizzle-orm";
import {
  createAbsencesBatchRequestSchema,
  createClosureEventRequestSchema,
  searchSlotsRequestSchema,
  bookRequestSchema,
  updateSlotCapacityRequestSchema,
  createSlotRequestSchema,
  updateSlotRequestSchema,
  deleteSlotRequestSchema,
  createAbsenceRequestSchema,
  createCourseRequestSchema,
  updateCourseRequestSchema,
  createTrialParticipantRequestSchema,
  updateTrialParticipantRequestSchema,
  updateClosureEventSlotsRequestSchema,
  validateClosureCodeRequestSchema,
  redeemClosureCodeRequestSchema,
} from "@shared/schema";
import { sendConfirmationEmail, sendExpiredEmail, sendAbsenceConfirmationEmail, sendMakeupConfirmationEmail, sendCancellationEmail, sendRequestCancellationEmail } from "./email-service";
import { createId } from "@paralleldrive/cuid2";
import { format, addDays } from "date-fns";
import { ja } from "date-fns/locale";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { ZodError } from "zod";
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
import { buildCanonicalSlotId } from "@shared/slotId";
import {
  getCanonicalSlotStartDateTime,
  getSlotDateISO,
  isDeadlineExpired,
  isSlotStarted,
} from "@shared/slotDateTime";
import { createClassSlots } from "./slotCreation";
import {
  reconcileDriftedSlotIdConflict,
  SLOT_ID_REKEY_TARGET_EXISTS,
} from "./slotIdReconciliation";
import {
  resolveAbsenceSlotReference,
  resolveRequestSlotReference,
  resolveSlotReference,
  upsertSlotIdAlias,
} from "./slotIdAliases";

// Admin authentication middleware
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const sess = req.session as any;
  const isAdmin = sess?.isAdmin === true;
  if (isAdmin) {
    next();
  } else {
    res.status(401).json({ error: "認証が必要です" });
  }
}

// Generate a 6-digit confirmation code
function generateConfirmCode(): string {
  return Math.random().toString().slice(2, 8).padStart(6, '0');
}

async function getClassSlotByExactId(executor: any, slotId: string) {
  const [slot] = await executor
    .select()
    .from(classSlots)
    .where(eq(classSlots.id, slotId))
    .limit(1);
  return slot;
}

async function rekeyDriftedSlotId(args: {
  currentSlot: typeof classSlots.$inferSelect;
  targetSlotId: string;
  targetSlotStartDateTime: Date;
}) {
  await db.transaction(async (tx) => {
    const currentSlot = await getClassSlotByExactId(tx, args.currentSlot.id);

    if (!currentSlot) {
      return;
    }

    if (currentSlot.id === args.targetSlotId) {
      return;
    }

    const conflictingTarget = await getClassSlotByExactId(tx, args.targetSlotId);
    if (conflictingTarget) {
      throw new Error(SLOT_ID_REKEY_TARGET_EXISTS);
    }

    await tx
      .insert(classSlots)
      .values({
        id: args.targetSlotId,
        date: currentSlot.date,
        startTime: currentSlot.startTime,
        courseLabel: currentSlot.courseLabel,
        classBand: currentSlot.classBand,
        isClosed: currentSlot.isClosed,
        capacityLimit: currentSlot.capacityLimit,
        capacityCurrent: currentSlot.capacityCurrent,
        capacityMakeupUsed: currentSlot.capacityMakeupUsed || 0,
        waitlistCount: currentSlot.waitlistCount || 0,
        lessonStartDateTime: args.targetSlotStartDateTime,
        lastNotifiedRequestId: currentSlot.lastNotifiedRequestId || null,
        createdAt: currentSlot.createdAt,
        updatedAt: new Date(),
      });

    await tx
      .update(requests)
      .set({
        toSlotId: args.targetSlotId,
        toSlotStartDateTime: args.targetSlotStartDateTime,
      })
      .where(eq(requests.toSlotId, currentSlot.id));

    await tx
      .update(absences)
      .set({
        originalSlotId: args.targetSlotId,
        updatedAt: new Date(),
      })
      .where(eq(absences.originalSlotId, currentSlot.id));

    await tx
      .update(closureEventSlots)
      .set({ slotId: args.targetSlotId })
      .where(eq(closureEventSlots.slotId, currentSlot.id));

    await tx
      .update(trialParticipants)
      .set({
        slotId: args.targetSlotId,
        updatedAt: new Date(),
      })
      .where(eq(trialParticipants.slotId, currentSlot.id));

    await upsertSlotIdAlias(tx, {
      legacySlotId: currentSlot.id,
      canonicalSlotId: args.targetSlotId,
      source: "rekey_drifted_slot_id",
    });

    await tx.delete(classSlots).where(eq(classSlots.id, currentSlot.id));
  });
}

function summarizeAbsenceBatchBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      bodyType: Array.isArray(body) ? "array" : typeof body,
    };
  }

  const top = body as Record<string, unknown>;
  const items = Array.isArray(top.items) ? top.items : null;
  const firstItem =
    items && items[0] && typeof items[0] === "object" && !Array.isArray(items[0])
      ? (items[0] as Record<string, unknown>)
      : null;

  return {
    topLevelKeys: Object.keys(top),
    hasItemsArray: Array.isArray(top.items),
    itemsLength: items?.length ?? null,
    firstItemKeys: firstItem ? Object.keys(firstItem) : null,
    reportTypeType: typeof top.reportType,
    contactEmailType: typeof top.contactEmail,
    reasonType: typeof top.reason,
  };
}

function summarizeZodIssues(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  }));
}

function looksLikeLegacyAbsencePayload(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }

  const top = body as Record<string, unknown>;
  if ("items" in top) {
    return false;
  }

  return (
    "childName" in top ||
    "declaredClassBand" in top ||
    "classBand" in top ||
    "absentDateISO" in top ||
    "originalSlotId" in top
  );
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

type AbsenceEntryInput = {
  childId?: string;
  childName: string;
  declaredClassBand: "初級" | "中級" | "上級";
  absentDateISO: string;
  originalSlotId: string;
};

type ReportType = "ABSENCE" | "LATE";

type NormalAbsenceBatchPayload = {
  reportType: ReportType;
  items: AbsenceEntryInput[];
  contactEmail?: string;
  reason?: string;
};

type CreateAbsenceInternalOptions = {
  contactEmail: string | null;
  reason: string | null;
  reportType: ReportType;
  sourceType: "NORMAL" | "CLOSURE_CODE";
  closureEventId: string | null;
  enforceBeforeStart: boolean;
  decrementOriginalSlotCurrent: boolean;
  makeupDeadlineCap?: Date;
};

type CreatedAbsenceInternal = {
  absenceId: string;
  resumeToken: string;
  confirmCode: string;
  makeupDeadline: Date;
  childName: string;
  declaredClassBand: "初級" | "中級" | "上級";
  absentDateISO: string;
  reportType: ReportType;
  originalSlot: typeof classSlots.$inferSelect;
};

class BatchRowError extends Error {
  rowIndex: number;

  constructor(rowIndex: number, message: string) {
    super(message);
    this.name = "BatchRowError";
    this.rowIndex = rowIndex;
  }
}

function normalizeOptionalText(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalEmail(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeSharedCode(value: string): string {
  return value.trim().toUpperCase();
}

function parseNormalAbsenceBatchPayload(body: unknown): {
  data: NormalAbsenceBatchPayload;
  payloadMode: "batch" | "legacy-single";
} {
  const batchResult = createAbsencesBatchRequestSchema.safeParse(body);
  if (batchResult.success) {
    return {
      data: batchResult.data,
      payloadMode: "batch",
    };
  }

  const singleResult = createAbsenceRequestSchema.safeParse(body);
  if (singleResult.success) {
    const singleData = singleResult.data;
    return {
      data: {
        reportType: singleData.reportType,
        contactEmail: singleData.contactEmail,
        reason: singleData.reason,
        items: [{
          childId: singleData.childId,
          childName: singleData.childName,
          declaredClassBand: singleData.declaredClassBand,
          absentDateISO: singleData.absentDateISO,
          originalSlotId: singleData.originalSlotId,
        }],
      },
      payloadMode: "legacy-single",
    };
  }

  if (looksLikeLegacyAbsencePayload(body)) {
    throw singleResult.error;
  }

  throw batchResult.error;
}

function resolveMakeupDeadline(baseDeadline: Date, cap?: Date): Date {
  if (!cap) {
    return baseDeadline;
  }
  return cap.getTime() < baseDeadline.getTime() ? cap : baseDeadline;
}

async function syncClosedSlotFlags(tx: any) {
  const activeRows = await tx
    .select({ slotId: closureEventSlots.slotId })
    .from(closureEventSlots)
    .innerJoin(closureEvents, eq(closureEventSlots.closureEventId, closureEvents.id))
    .where(eq(closureEvents.isArchived, false));

  const closedSlotIds = Array.from(new Set((activeRows as Array<{ slotId: string }>).map((row) => row.slotId)));
  const now = new Date();

  await tx
    .update(classSlots)
    .set({
      isClosed: false,
      updatedAt: now,
    });

  if (closedSlotIds.length > 0) {
    await tx
      .update(classSlots)
      .set({
        isClosed: true,
        updatedAt: now,
      })
      .where(inArray(classSlots.id, closedSlotIds));
  }
}

async function createAbsenceRecordInTransaction(
  tx: any,
  entry: AbsenceEntryInput,
  options: CreateAbsenceInternalOptions,
): Promise<CreatedAbsenceInternal> {
  const absentDate = parseJstDate(entry.absentDateISO);
  const originalSlotRef = await resolveSlotReference(tx, entry.originalSlotId);
  const originalSlot = originalSlotRef?.slot;
  if (!originalSlotRef || !originalSlot) {
    throw new Error("指定されたレッスン枠が見つかりません。");
  }

  if (options.sourceType === "NORMAL" && originalSlot.isClosed) {
    throw new Error("休講対象枠のため通常欠席登録できません。休講用の共通コード導線をご利用ください。");
  }

  const slotDateStr = getSlotDateISO(originalSlot);
  if (slotDateStr !== entry.absentDateISO) {
    throw new Error("選択したレッスン枠の日付が欠席日と一致しません。");
  }

  if (originalSlot.classBand !== entry.declaredClassBand) {
    throw new Error("選択したレッスン枠のクラス帯が一致しません。");
  }

  if (options.enforceBeforeStart) {
    const now = new Date();
    if (isSlotStarted(originalSlot, now)) {
      throw new Error("レッスン開始時刻までに欠席連絡がないため、振替登録はできません。");
    }
  }

  const settings = await storage.getGlobalSettings();
  const makeupWindowDays = settings?.makeupWindowDays || 30;
  const rawMakeupDeadline = addJstDays(absentDate, makeupWindowDays);
  const makeupDeadline = resolveMakeupDeadline(rawMakeupDeadline, options.makeupDeadlineCap);
  const resumeToken = createId();
  const absenceId = createId();
  const confirmCode = generateConfirmCode();

  await tx.insert(absences).values({
    id: absenceId,
    userId: null,
    childId: entry.childId || null,
    childName: entry.childName,
    declaredClassBand: entry.declaredClassBand,
    reportType: options.reportType,
    absentDate,
    originalSlotId: originalSlotRef.canonicalSlotId,
    contactEmail: options.contactEmail,
    reason: options.reason,
    sourceType: options.sourceType,
    closureEventId: options.closureEventId,
    resumeToken,
    confirmCode,
    makeupDeadline,
    makeupStatus: "PENDING",
  });

  if (options.decrementOriginalSlotCurrent && options.sourceType === "NORMAL" && options.reportType === "ABSENCE") {
    await tx
      .update(classSlots)
      .set({
        capacityCurrent: sql`GREATEST(0, ${classSlots.capacityCurrent} - 1)`,
        updatedAt: new Date(),
      })
      .where(eq(classSlots.id, originalSlotRef.canonicalSlotId));
  }

  return {
    absenceId,
    resumeToken,
    confirmCode,
    makeupDeadline,
    childName: entry.childName,
    declaredClassBand: entry.declaredClassBand,
    absentDateISO: entry.absentDateISO,
    reportType: options.reportType,
    originalSlot,
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
    const shouldRestoreOriginalSlotCurrent = absence.sourceType === "NORMAL" && absence.reportType === "ABSENCE";
    const originalSlotRef = shouldRestoreOriginalSlotCurrent
      ? await resolveAbsenceSlotReference(tx, absence)
      : undefined;

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

    if (shouldRestoreOriginalSlotCurrent && options.enforceGraceRule && !isWithinAbsenceGracePeriod(absence.createdAt)) {
      const originalSlot = originalSlotRef?.slot;
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
        const requestSlotRef = await resolveRequestSlotReference(tx, request);
        if (requestSlotRef) {
          await tx
            .update(classSlots)
            .set({
              capacityMakeupUsed: sql`GREATEST(0, ${classSlots.capacityMakeupUsed} - 1)`,
              updatedAt: new Date(),
            })
            .where(eq(classSlots.id, requestSlotRef.canonicalSlotId));
        }

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

    if (shouldRestoreOriginalSlotCurrent) {
      if (originalSlotRef) {
        await tx
          .update(classSlots)
          .set({
            capacityCurrent: sql`${classSlots.capacityCurrent} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(classSlots.id, originalSlotRef.canonicalSlotId));
      }
    }

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

    const slotRef = await resolveRequestSlotReference(tx, request);
    const slot = slotRef?.slot;

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
    if (wasConfirmed && slotRef) {
      await tx
        .update(classSlots)
        .set({
          capacityMakeupUsed: sql`GREATEST(0, ${classSlots.capacityMakeupUsed} - 1)`,
          updatedAt: new Date(),
        })
        .where(eq(classSlots.id, slotRef.canonicalSlotId));
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
        maxAge: 10 * 365 * 24 * 60 * 60 * 1000,
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
    if (isAdmin) {
      res.json({ authenticated: true });
    } else {
      res.json({ authenticated: false });
    }
  });

  app.post("/api/admin/logout", (req, res) => {
    const session = req.session as any;
    session.isAdmin = false;
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

      const slotRef = absence.originalSlotId
        ? await resolveAbsenceSlotReference(db, absence)
        : null;
      const slot = slotRef?.slot ?? null;

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
            absenceCount: status?.absences.filter((absence) => absence.reportType === "ABSENCE").length || 0,
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
          const slot = (await resolveAbsenceSlotReference(db, absence))?.slot;
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
      const allRequests = await db.select().from(requests).orderBy(desc(requests.createdAt));

      // Enrich with slot info
      const enrichedRequests = await Promise.all(
        allRequests.map(async (request) => {
          const slot = (await resolveRequestSlotReference(db, request))?.slot;
          return {
            ...request,
            courseLabel: slot?.courseLabel || null,
            toSlotDate: slot ? formatJstDate(slot.date) : null,
            toSlotStartTime: slot?.startTime || null,
          };
        })
      );

      res.json(enrichedRequests);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/closure-events", requireAdmin, async (_req, res) => {
    try {
      const events = await db
        .select()
        .from(closureEvents)
        .orderBy(asc(closureEvents.isArchived), asc(closureEvents.expiresAt), asc(closureEvents.createdAt));

      if (events.length === 0) {
        return res.json([]);
      }

      const eventIds = events.map((event) => event.id);
      const linkedSlots = await db
        .select({
          closureEventId: closureEventSlots.closureEventId,
          slotId: classSlots.id,
          date: classSlots.date,
          startTime: classSlots.startTime,
          classBand: classSlots.classBand,
          courseLabel: classSlots.courseLabel,
          isClosed: classSlots.isClosed,
        })
        .from(closureEventSlots)
        .innerJoin(classSlots, eq(closureEventSlots.slotId, classSlots.id))
        .where(inArray(closureEventSlots.closureEventId, eventIds))
        .orderBy(asc(classSlots.date), asc(classSlots.startTime), asc(classSlots.classBand));

      const slotsByEventId = linkedSlots.reduce((acc, slot) => {
        if (!acc[slot.closureEventId]) {
          acc[slot.closureEventId] = [];
        }
        acc[slot.closureEventId].push(slot);
        return acc;
      }, {} as Record<string, typeof linkedSlots>);

      res.json(events.map((event) => ({
        ...event,
        usageRemaining: Math.max(0, event.usageLimit - event.usageUsed),
        slots: (slotsByEventId[event.id] || []).map((slot) => ({
          ...slot,
          date: formatJstDate(slot.date),
        })),
      })));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/closure-events", requireAdmin, async (req, res) => {
    try {
      const data = createClosureEventRequestSchema.parse(req.body);
      const normalizedCode = normalizeSharedCode(data.sharedCode);
      const uniqueSlotIds = Array.from(new Set(data.slotIds));
      const expiresAt = parseJstDate(data.expiresAtISO);

      const [existingCode] = await db
        .select({ id: closureEvents.id })
        .from(closureEvents)
        .where(eq(closureEvents.sharedCode, normalizedCode));

      if (existingCode) {
        return res.status(400).json({ error: "同じ共通コードが既に使われています。" });
      }

      const slots = await db
        .select({ id: classSlots.id })
        .from(classSlots)
        .where(inArray(classSlots.id, uniqueSlotIds));

      if (slots.length !== uniqueSlotIds.length) {
        return res.status(400).json({ error: "対象枠に存在しないIDが含まれています。" });
      }

      const created = await db.transaction(async (tx) => {
        const eventId = createId();
        const now = new Date();
        const [event] = await tx
          .insert(closureEvents)
          .values({
            id: eventId,
            name: data.name.trim(),
            sharedCode: normalizedCode,
            usageLimit: data.usageLimit,
            usageUsed: 0,
            expiresAt,
            isArchived: false,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        await tx.insert(closureEventSlots).values(
          uniqueSlotIds.map((slotId) => ({
            closureEventId: eventId,
            slotId,
          })),
        );

        await tx
          .update(classSlots)
          .set({
            isClosed: true,
            updatedAt: now,
          })
          .where(inArray(classSlots.id, uniqueSlotIds));

        return event;
      });

      res.json({
        success: true,
        event: created,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/admin/closure-events/:id/close-slots", requireAdmin, async (req, res) => {
    try {
      const eventId = req.params.id;
      const data = updateClosureEventSlotsRequestSchema.parse(req.body);
      const uniqueSlotIds = Array.from(new Set(data.slotIds));

      const slots = await db
        .select({ id: classSlots.id })
        .from(classSlots)
        .where(inArray(classSlots.id, uniqueSlotIds));

      if (slots.length !== uniqueSlotIds.length) {
        return res.status(400).json({ error: "対象枠に存在しないIDが含まれています。" });
      }

      await db.transaction(async (tx) => {
        const [event] = await tx.select().from(closureEvents).where(eq(closureEvents.id, eventId));
        if (!event) {
          throw new Error("CLOSURE_EVENT_NOT_FOUND");
        }

        await tx.delete(closureEventSlots).where(eq(closureEventSlots.closureEventId, eventId));
        await tx.insert(closureEventSlots).values(
          uniqueSlotIds.map((slotId) => ({
            closureEventId: eventId,
            slotId,
          })),
        );

        await tx
          .update(closureEvents)
          .set({ updatedAt: new Date() })
          .where(eq(closureEvents.id, eventId));

        await syncClosedSlotFlags(tx);
      });

      res.json({ success: true });
    } catch (error: any) {
      if (error.message === "CLOSURE_EVENT_NOT_FOUND") {
        return res.status(404).json({ error: "休講イベントが見つかりません。" });
      }
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/admin/closure-events/:id/archive", requireAdmin, async (req, res) => {
    try {
      const eventId = req.params.id;

      await db.transaction(async (tx) => {
        const [event] = await tx.select().from(closureEvents).where(eq(closureEvents.id, eventId));
        if (!event) {
          throw new Error("CLOSURE_EVENT_NOT_FOUND");
        }

        await tx
          .update(closureEvents)
          .set({
            isArchived: true,
            updatedAt: new Date(),
          })
          .where(eq(closureEvents.id, eventId));

        await syncClosedSlotFlags(tx);
      });

      res.json({ success: true });
    } catch (error: any) {
      if (error.message === "CLOSURE_EVENT_NOT_FOUND") {
        return res.status(404).json({ error: "休講イベントが見つかりません。" });
      }
      res.status(400).json({ error: error.message });
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
        todayAbsences += slotAbsences.filter((absence) => absence.reportType === "ABSENCE").length;
        todayMakeups += slotMakeups.length;
      }

      // Get total pending absences (makeup not yet confirmed)
      const allAbsences = await storage.getAllAbsences();
      const pendingAbsences = allAbsences.filter(a => a.makeupStatus === "PENDING" && a.reportType === "ABSENCE").length;

      res.json({
        todayAbsences,
        todayMakeups,
        pendingAbsences,
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

      const targetDate = date && typeof date === "string"
        ? parseJstDate(date)
        : startOfJstDay(new Date());

      // Get all slots for the target date
      const slots = await storage.getClassSlotsByDate(targetDate);

      // Collect absences (students absent from this date's lessons)
      const absentees: Array<{
        childName: string;
        courseLabel: string;
        classBand: string;
        startTime: string;
        reportType: "ABSENCE" | "LATE";
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
            reportType: absence.reportType as "ABSENCE" | "LATE",
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

      const trialParticipantsForDate = await storage.getTrialParticipantsByDate(targetDate);
      const dailyTrialParticipants = trialParticipantsForDate.map((participant) => ({
        id: participant.id,
        participantName: participant.participantName,
        grade: participant.grade,
        swimLevel: participant.swimLevel,
        slotId: participant.slotId,
        courseLabel: participant.courseLabel,
        classBand: participant.classBand,
        startTime: participant.startTime,
      }));

      // Sort by startTime, then by name
      const sortFn = (a: any, b: any) => {
        const timeCompare = a.startTime.localeCompare(b.startTime);
        if (timeCompare !== 0) return timeCompare;
        return a.childName.localeCompare(b.childName);
      };

      absentees.sort(sortFn);
      makeups.sort(sortFn);
      dailyTrialParticipants.sort((a, b) => {
        const timeCompare = a.startTime.localeCompare(b.startTime);
        if (timeCompare !== 0) return timeCompare;
        return a.participantName.localeCompare(b.participantName, "ja");
      });

      res.json({
        date: formatJstDate(targetDate),
        absentees,
        makeups,
        trialParticipants: dailyTrialParticipants,
      });
    } catch (error: any) {
      console.error("Daily status error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/trial-participants", requireAdmin, async (req, res) => {
    try {
      const data = createTrialParticipantRequestSchema.parse(req.body);

      const slot = await storage.getClassSlotById(data.slotId);
      if (!slot) {
        return res.status(400).json({ error: "指定された参加枠が見つかりません。" });
      }

      const created = await storage.createTrialParticipant(data);
      res.json({ success: true, trialParticipant: created });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put("/api/admin/trial-participants/:id", requireAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      const data = updateTrialParticipantRequestSchema.parse(req.body);

      const existing = await storage.getTrialParticipantById(id);
      if (!existing) {
        return res.status(404).json({ error: "指定された体験者が見つかりません。" });
      }

      if (data.slotId) {
        const slot = await storage.getClassSlotById(data.slotId);
        if (!slot) {
          return res.status(400).json({ error: "指定された参加枠が見つかりません。" });
        }
      }

      const updated = await storage.updateTrialParticipant(id, data);
      if (!updated) {
        return res.status(404).json({ error: "指定された体験者が見つかりません。" });
      }

      res.json({ success: true, trialParticipant: updated });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/admin/trial-participants/:id", requireAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      const deleted = await storage.deleteTrialParticipant(id);

      if (!deleted) {
        return res.status(404).json({ error: "指定された体験者が見つかりません。" });
      }

      res.json({ success: true, message: "体験者情報を削除しました。" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
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
      const openSlots = slots.filter((slot) => !slot.isClosed);

      const now = new Date();
      res.json({
        success: true,
        slots: openSlots.map(slot => {
          const canonicalSlotStartDateTime = getCanonicalSlotStartDateTime(slot);
          return {
            id: slot.id,
            date: formatJstDate(slot.date),
            startTime: slot.startTime,
            courseLabel: slot.courseLabel,
            classBand: slot.classBand,
            lessonStartDateTime: canonicalSlotStartDateTime.toISOString(),
            isPastLesson: isSlotStarted(slot, now),
          };
        })
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  async function sendAbsenceConfirmationEmails(
    contactEmail: string | null,
    createdAbsences: CreatedAbsenceInternal[],
  ) {
    if (!contactEmail) {
      return;
    }

    for (const created of createdAbsences) {
      try {
        await sendAbsenceConfirmationEmail(
          contactEmail,
          created.childName,
          created.declaredClassBand,
          format(parseJstDate(created.absentDateISO), "yyyy年M月d日"),
          format(created.makeupDeadline, "yyyy年M月d日"),
          created.reportType,
          created.resumeToken,
          created.absenceId,
          created.originalSlot.courseLabel,
          created.originalSlot.startTime,
          created.confirmCode,
        );
      } catch (error: any) {
        console.error("欠席確認メール送信エラー:", error.message);
      }
    }
  }

  function buildBatchAbsenceResponseItems(createdAbsences: CreatedAbsenceInternal[]) {
    return createdAbsences.map((item) => ({
      absenceId: item.absenceId,
      resumeToken: item.resumeToken,
      confirmCode: item.confirmCode,
      makeupDeadline: formatJstDate(item.makeupDeadline),
      childName: item.childName,
      declaredClassBand: item.declaredClassBand,
      absentDateISO: item.absentDateISO,
      reportType: item.reportType,
    }));
  }

  async function createNormalAbsences(data: NormalAbsenceBatchPayload) {
    const contactEmail = normalizeOptionalEmail(data.contactEmail);
    const reason = normalizeOptionalText(data.reason);
    const reportType = data.reportType;

    const slotCount = await storage.countFutureSlots();
    if (slotCount === 0) {
      console.warn("⚠️ 振替可能なレッスン枠が登録されていません。欠席登録は受け付けますが、振替予約はできません。");
    }

    const createdAbsences = await db.transaction(async (tx) => {
      const created: CreatedAbsenceInternal[] = [];
      for (let index = 0; index < data.items.length; index += 1) {
        const row = data.items[index];
        try {
          const item = await createAbsenceRecordInTransaction(tx, row, {
            contactEmail,
            reason,
            reportType,
            sourceType: "NORMAL",
            closureEventId: null,
            enforceBeforeStart: true,
            decrementOriginalSlotCurrent: true,
          });
          created.push(item);
        } catch (error: any) {
          throw new BatchRowError(index, error.message || "登録に失敗しました。");
        }
      }
      return created;
    });

    await sendAbsenceConfirmationEmails(contactEmail, createdAbsences);

    return {
      reportType,
      contactEmail,
      reason,
      createdAbsences,
    };
  }

  app.post("/api/closure-events/validate-code", async (req, res) => {
    try {
      const data = validateClosureCodeRequestSchema.parse(req.body);
      const sharedCode = normalizeSharedCode(data.sharedCode);
      const now = new Date();
      const [event] = await db
        .select()
        .from(closureEvents)
        .where(and(
          eq(closureEvents.sharedCode, sharedCode),
          eq(closureEvents.isArchived, false),
        ));

      if (!event) {
        return res.status(400).json({ error: "共通コードが無効です。" });
      }

      if (isDeadlineExpired(event.expiresAt, now)) {
        return res.status(400).json({ error: "この共通コードは有効期限切れです。" });
      }

      if (event.usageUsed >= event.usageLimit) {
        return res.status(400).json({ error: "この共通コードの利用上限に達しています。" });
      }

      const slots = await db
        .select({
          id: classSlots.id,
          date: classSlots.date,
          startTime: classSlots.startTime,
          classBand: classSlots.classBand,
          courseLabel: classSlots.courseLabel,
          isClosed: classSlots.isClosed,
        })
        .from(closureEventSlots)
        .innerJoin(classSlots, eq(closureEventSlots.slotId, classSlots.id))
        .where(eq(closureEventSlots.closureEventId, event.id))
        .orderBy(asc(classSlots.date), asc(classSlots.startTime), asc(classSlots.classBand));

      res.json({
        id: event.id,
        name: event.name,
        sharedCode: event.sharedCode,
        usageLimit: event.usageLimit,
        usageUsed: event.usageUsed,
        usageRemaining: Math.max(0, event.usageLimit - event.usageUsed),
        expiresAt: formatJstDate(event.expiresAt),
        slots: slots.map((slot) => ({
          ...slot,
          date: formatJstDate(slot.date),
        })),
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/closure-events/redeem", async (req, res) => {
    try {
      const data = redeemClosureCodeRequestSchema.parse(req.body);
      const sharedCode = normalizeSharedCode(data.sharedCode);
      const contactEmail = normalizeOptionalEmail(data.contactEmail);
      const reason = normalizeOptionalText(data.reason);
      const now = new Date();

      const createdAbsences = await db.transaction(async (tx) => {
        const [event] = await tx
          .select()
          .from(closureEvents)
          .where(and(
            eq(closureEvents.sharedCode, sharedCode),
            eq(closureEvents.isArchived, false),
          ));

        if (!event) {
          throw new Error("共通コードが無効です。");
        }

        if (isDeadlineExpired(event.expiresAt, now)) {
          throw new Error("この共通コードは有効期限切れです。");
        }

        if (event.usageUsed + data.items.length > event.usageLimit) {
          throw new Error("この共通コードの利用上限を超えるため登録できません。");
        }

        const eventSlots = await tx
          .select({ slotId: closureEventSlots.slotId })
          .from(closureEventSlots)
          .where(eq(closureEventSlots.closureEventId, event.id));
        const availableSlotIds = new Set(eventSlots.map((slot: { slotId: string }) => slot.slotId));

        const created: CreatedAbsenceInternal[] = [];
        for (let index = 0; index < data.items.length; index += 1) {
          const row = data.items[index];
          if (!availableSlotIds.has(row.originalSlotId)) {
            throw new BatchRowError(index, "指定した欠席枠はこの休講イベントの対象外です。");
          }

          try {
            const item = await createAbsenceRecordInTransaction(tx, row, {
              contactEmail,
              reason,
              reportType: "ABSENCE",
              sourceType: "CLOSURE_CODE",
              closureEventId: event.id,
              enforceBeforeStart: false,
              decrementOriginalSlotCurrent: false,
              makeupDeadlineCap: event.expiresAt,
            });
            created.push(item);
          } catch (error: any) {
            if (error instanceof BatchRowError) {
              throw error;
            }
            throw new BatchRowError(index, error.message || "登録に失敗しました。");
          }
        }

        const [updatedEvent] = await tx
          .update(closureEvents)
          .set({
            usageUsed: sql`${closureEvents.usageUsed} + ${data.items.length}`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(closureEvents.id, event.id),
            sql`${closureEvents.usageUsed} + ${data.items.length} <= ${closureEvents.usageLimit}`,
          ))
          .returning();

        if (!updatedEvent) {
          throw new Error("同時利用により上限を超えたため、もう一度お試しください。");
        }

        return created;
      });

      await sendAbsenceConfirmationEmails(contactEmail, createdAbsences);

      res.json({
        success: true,
        sourceType: "CLOSURE_CODE",
        items: createdAbsences.map((item) => ({
          absenceId: item.absenceId,
          resumeToken: item.resumeToken,
          confirmCode: item.confirmCode,
          makeupDeadline: formatJstDate(item.makeupDeadline),
          childName: item.childName,
          declaredClassBand: item.declaredClassBand,
          absentDateISO: item.absentDateISO,
          reportType: item.reportType,
        })),
      });
    } catch (error: any) {
      if (error instanceof BatchRowError) {
        return res.status(400).json({
          error: error.message,
          rowIndex: error.rowIndex,
        });
      }
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/absences/batch", async (req, res) => {
    try {
      const { data, payloadMode } = parseNormalAbsenceBatchPayload(req.body);
      if (payloadMode === "legacy-single") {
        console.warn("Using legacy single payload compatibility path for /api/absences/batch", {
          summary: summarizeAbsenceBatchBody(req.body),
        });
      }

      const { createdAbsences } = await createNormalAbsences(data);

      res.json({
        success: true,
        items: buildBatchAbsenceResponseItems(createdAbsences),
      });
    } catch (error: any) {
      if (error instanceof ZodError) {
        console.warn("Invalid /api/absences/batch payload", {
          preferredParser: looksLikeLegacyAbsencePayload(req.body) ? "legacy-single" : "batch",
          summary: summarizeAbsenceBatchBody(req.body),
          issues: summarizeZodIssues(error),
        });
      }
      if (error instanceof BatchRowError) {
        return res.status(400).json({
          error: error.message,
          rowIndex: error.rowIndex,
        });
      }
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/absences", async (req, res) => {
    try {
      const data = createAbsenceRequestSchema.parse(req.body);
      const { createdAbsences } = await createNormalAbsences({
        reportType: data.reportType,
        contactEmail: data.contactEmail,
        reason: data.reason,
        items: [data],
      });
      const [created] = createdAbsences;

      res.json({
        success: true,
        absenceId: created.absenceId,
        resumeToken: created.resumeToken,
        confirmCode: created.confirmCode,
        makeupDeadline: formatJstDate(created.makeupDeadline),
        reportType: created.reportType,
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
        reportType: absence.reportType,
        absentDate: formatJstDate(absence.absentDate),
        originalSlotId: absence.originalSlotId,
        contactEmail: absence.contactEmail,
        reason: absence.reason,
        confirmCode: absence.confirmCode,
        sourceType: absence.sourceType,
        closureEventId: absence.closureEventId,
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

      const slots = allSlots.filter((slot) =>
        slot.classBand === data.declaredClassBand && !slot.isClosed && !isSlotStarted(slot, now)
      );

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
        const slotRef = await resolveSlotReference(tx, data.toSlotId);
        const slot = slotRef?.slot;
        if (!slotRef || !slot) {
          throw new Error("BOOK_SLOT_NOT_FOUND");
        }

        if (slot.classBand !== data.declaredClassBand) {
          throw new Error("BOOK_CLASS_BAND_MISMATCH");
        }

        if (slot.isClosed) {
          throw new Error("BOOK_SLOT_CLOSED");
        }

        const slotStartDateTime = getCanonicalSlotStartDateTime(slot);
        if (isSlotStarted(slot, now)) {
          throw new Error("BOOK_SLOT_STARTED");
        }

        if (!hasRemainingCapacity(slot, 1)) {
          throw new Error("BOOK_SLOT_FULL");
        }

        const duplicateRequest = await tx.select({ id: requests.id }).from(requests).where(and(
          eq(requests.status, "確定"),
          eq(requests.childName, data.childName),
          eq(requests.toSlotStartDateTime, slotStartDateTime),
        ));
        if (duplicateRequest.length > 0) {
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
          if (absence.reportType === "LATE") {
            throw new Error("BOOK_LATE_NOT_BOOKABLE");
          }
          if (absence.makeupStatus !== "PENDING") {
            throw new Error("BOOK_ABSENCE_NOT_PENDING");
          }
          if (isDeadlineExpired(absence.makeupDeadline, now)) {
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
            eq(classSlots.id, slotRef.canonicalSlotId),
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
          toSlotId: slotRef.canonicalSlotId,
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
      if (error.message === "BOOK_SLOT_CLOSED") {
        return res.status(400).json({ success: false, message: "この枠は休講のため予約できません。" });
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
      if (error.message === "BOOK_LATE_NOT_BOOKABLE") {
        return res.status(400).json({ success: false, message: "遅刻連絡では振替予約できません。" });
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


  app.post("/admin/update-slot-capacity", requireAdmin, async (req, res) => {
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
      const canCancel = request.status === "確定";
      const alreadyCancelled = isRequestCancelledStatus(request.status);

      res.json({
        success: true,
        message: canCancel
          ? `${statusText}をキャンセルできます`
          : alreadyCancelled
            ? `${statusText}は既にキャンセル済みです`
            : "このリクエストは既に処理されています。",
        requestId: request.id,
        childName: request.childName,
        statusText: statusText,
        status: request.status,
        canCancel,
        alreadyCancelled,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "エラーが発生しました" });
    }
  });

  app.get("/api/wait-decline", async (req, res) => {
    const renderPage = (
      title: string,
      message: string,
      isSuccess: boolean,
      action?: { label: string; method: "GET" | "POST"; url: string },
    ) => {
      const actionHtml = action
        ? `<form method="${action.method}" action="${action.url}" style="margin-top: 8px;"><button type="submit" class="button">${action.label}</button></form>`
        : `<button class="button" onclick="window.history.back()">戻る</button>`;

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
    ${actionHtml}
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

      if (isRequestCancelledStatus(request.status)) {
        return res.status(400).send(renderPage(
          "既に処理されています",
          "このリクエストは既に処理されています。",
          false
        ));
      }

      res.send(renderPage(
        "辞退の確認",
        `${request.childName}さんの振替予約を辞退しますか？`,
        false,
        {
          label: "辞退を確定する",
          method: "POST",
          url: `/api/wait-decline?token=${encodeURIComponent(token)}`,
        }
      ));
    } catch (error: any) {
      res.status(500).send(renderPage(
        "エラーが発生しました",
        `予期しないエラーが発生しました。${error.message || "もう一度お試しください。"}`,
        false
      ));
    }
  });

  app.post("/api/wait-decline", async (req, res) => {
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


  app.get("/api/admin/slot-requests-count", requireAdmin, async (req, res) => {
    try {
      const { slotId } = req.query;
      if (!slotId || typeof slotId !== "string") {
        return res.status(400).json({ error: "slotIdが必要です" });
      }

      const slotRequests = await storage.getRequestsBySlotId(slotId);
      const confirmedCount = slotRequests.filter((request) => request.status === "確定").length;

      res.json({
        slotId,
        count: slotRequests.length,
        confirmedCount,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
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
      let autoRepairedCount = 0;
      const { createdSlots, skippedCount } = await createClassSlots({
        getClassSlotByExactId: async (id) => {
          const reconciliation = await reconcileDriftedSlotIdConflict({
            getClassSlotByExactId: (slotId) => getClassSlotByExactId(db, slotId),
            rekeySlotId: (args) => rekeyDriftedSlotId(args),
          }, id);

          if (reconciliation === "blocked") {
            throw new Error("CREATE_SLOT_DRIFT_BLOCKED");
          }

          if (reconciliation === "repaired") {
            autoRepairedCount += 1;
          }

          return getClassSlotByExactId(db, id);
        },
        createClassSlot: (slot) => storage.createClassSlot(slot),
      }, data);

      if (data.isRecurring && data.recurringWeeks) {
        if (createdSlots.length === 0) {
          return res.status(409).json({
            error: "指定した期間・開始時刻・クラス帯の枠はすべて既に存在します。",
            count: 0,
            skippedCount,
          });
        }

        res.json({
          success: true,
          count: createdSlots.length,
          skippedCount,
          autoRepairedCount,
          message: skippedCount > 0
            ? `${createdSlots.length}個の枠を作成しました（${skippedCount}個は既存枠と重複したためスキップ）`
            : `${createdSlots.length}個の枠を作成しました`,
          slots: createdSlots
        });
      } else {
        if (createdSlots.length === 0) {
          return res.status(409).json({
            error: "指定した日付・開始時刻・クラス帯の枠は既に存在します。",
            count: 0,
            skippedCount,
          });
        }

        res.json({
          success: true,
          count: createdSlots.length,
          skippedCount,
          autoRepairedCount,
          message: skippedCount > 0
            ? `${createdSlots.length}個の枠を作成しました（${skippedCount}個は既存枠と重複したためスキップ）`
            : `${createdSlots.length}個の枠を作成しました`,
          slots: createdSlots
        });
      }
    } catch (error: any) {
      if (error.message === "CREATE_SLOT_DRIFT_BLOCKED") {
        return res.status(409).json({
          error: "過去データの枠ID不整合が残っているため、この枠はまだ作成できません。補修後に再度お試しください。",
        });
      }
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

      const existingDateISO = getSlotDateISO(existing);
      const existingClassBand = existing.classBand as "初級" | "中級" | "上級";
      const existingCanonicalSlotId = buildCanonicalSlotId(existingDateISO, existing.startTime, existingClassBand);
      const targetDateISO = data.date || existingDateISO;
      const targetStartTime = data.startTime || existing.startTime;
      const targetClassBand = (data.classBand || existingClassBand) as "初級" | "中級" | "上級";
      const targetSlotId = buildCanonicalSlotId(targetDateISO, targetStartTime, targetClassBand);
      const keyFieldsChanged = targetSlotId !== existingCanonicalSlotId;

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
        const dateStr = getSlotDateISO(existing);
        updateData.lessonStartDateTime = parseJstDateTime(dateStr, data.startTime);
      }

      if (data.applyToFuture) {
        if (keyFieldsChanged) {
          throw new Error("UPDATE_SLOT_KEY_CHANGE_APPLY_TO_FUTURE_UNSUPPORTED");
        }

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
        if (!keyFieldsChanged) {
          const updated = await storage.updateClassSlot(existing.id, updateData);
          return res.json({ success: true, slot: updated });
        }

        const replacementSlot = await db.transaction(async (tx) => {
          const conflict = await tx
            .select({ id: classSlots.id })
            .from(classSlots)
            .where(eq(classSlots.id, targetSlotId))
            .limit(1);
          if (conflict.length > 0) {
            throw new Error("UPDATE_SLOT_ID_CONFLICT");
          }

          const [createdSlot] = await tx
            .insert(classSlots)
            .values({
              id: targetSlotId,
              date: updateData.date || existing.date,
              startTime: updateData.startTime || existing.startTime,
              courseLabel: updateData.courseLabel || existing.courseLabel,
              classBand: updateData.classBand || existing.classBand,
              isClosed: existing.isClosed,
              capacityLimit: updateData.capacityLimit ?? existing.capacityLimit,
              capacityCurrent: updateData.capacityCurrent ?? existing.capacityCurrent,
              capacityMakeupUsed: existing.capacityMakeupUsed || 0,
              waitlistCount: existing.waitlistCount || 0,
              lessonStartDateTime: getCanonicalSlotStartDateTime({
                date: updateData.date || existing.date,
                startTime: updateData.startTime || existing.startTime,
              }),
              lastNotifiedRequestId: existing.lastNotifiedRequestId || null,
              createdAt: existing.createdAt,
              updatedAt: new Date(),
            })
            .returning();

          if (!createdSlot) {
            throw new Error("UPDATE_SLOT_REKEY_FAILED");
          }

          await tx
            .update(requests)
            .set({
              toSlotId: targetSlotId,
              toSlotStartDateTime: createdSlot.lessonStartDateTime,
            })
            .where(eq(requests.toSlotId, existing.id));

          await tx
            .update(absences)
            .set({
              originalSlotId: targetSlotId,
              updatedAt: new Date(),
            })
            .where(eq(absences.originalSlotId, existing.id));

          await tx
            .update(closureEventSlots)
            .set({ slotId: targetSlotId })
            .where(eq(closureEventSlots.slotId, existing.id));

          await tx
            .update(trialParticipants)
            .set({
              slotId: targetSlotId,
              updatedAt: new Date(),
            })
            .where(eq(trialParticipants.slotId, existing.id));

          await upsertSlotIdAlias(tx, {
            legacySlotId: existing.id,
            canonicalSlotId: targetSlotId,
            source: "admin_update_slot",
          });

          await tx.delete(classSlots).where(eq(classSlots.id, existing.id));

          return createdSlot;
        });

        return res.json({ success: true, slot: replacementSlot });
      }
    } catch (error: any) {
      if (error.message === "UPDATE_SLOT_ID_CONFLICT") {
        return res.status(400).json({ error: "更新後の枠IDが既存枠と重複するため、更新できません。" });
      }
      if (error.message === "UPDATE_SLOT_KEY_CHANGE_APPLY_TO_FUTURE_UNSUPPORTED") {
        return res.status(400).json({ error: "日付・時刻・クラス帯の変更と「以降に適用」は同時に実行できません。" });
      }
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

      if (!data.applyToFuture) {
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

        await storage.deleteClassSlot(existing.id);

        return res.json({
          success: true,
          message: "枠を削除しました。",
          count: 1,
          skipped: 0,
          deletedRequests: slotRequests.length,
        });
      }

      const dayOfWeek = getJstDayOfWeek(existing.date);
      const allCandidateSlots = await db
        .select()
        .from(classSlots)
        .where(and(
          eq(classSlots.startTime, existing.startTime),
          eq(classSlots.classBand, existing.classBand),
          eq(classSlots.courseLabel, existing.courseLabel),
          gte(classSlots.date, existing.date),
        ));
      const targetSlots = allCandidateSlots.filter((slot) => getJstDayOfWeek(slot.date) === dayOfWeek);

      let deletedCount = 0;
      let skippedCount = 0;
      let deletedRequestCount = 0;

      for (const slot of targetSlots) {
        const slotAbsences = await storage.getAbsencesByOriginalSlotId(slot.id);
        if (slotAbsences.length > 0) {
          skippedCount++;
          continue;
        }

        const slotRequests = await storage.getRequestsBySlotId(slot.id);
        for (const request of slotRequests) {
          await storage.deleteRequest(request.id);
        }

        deletedRequestCount += slotRequests.length;
        await storage.deleteClassSlot(slot.id);
        deletedCount++;
      }

      if (skippedCount > 0 && deletedCount === 0) {
        return res.status(400).json({
          error: `対象の${skippedCount}件の枠には欠席登録があるため削除できませんでした。`
        });
      }

      return res.json({
        success: true,
        message: `${deletedCount}件の枠を削除しました。`,
        count: deletedCount,
        skipped: skippedCount,
        deletedRequests: deletedRequestCount,
      });
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

        await storage.deleteClassSlot(existing.id);
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

  app.get("/api/settings", requireAdmin, async (req, res) => {
    try {
      const settings = await storage.getGlobalSettings();
      res.json(settings || { id: 1, makeupWindowDays: 30, cutoffTime: "16:00" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/settings", requireAdmin, async (req, res) => {
    try {
      const { makeupWindowDays, cutoffTime } = req.body;
      const settings = await storage.updateGlobalSettings({ makeupWindowDays, cutoffTime });
      res.json(settings);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/holidays", requireAdmin, async (req, res) => {
    try {
      const allHolidays = await storage.getAllHolidays();
      res.json(allHolidays);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/holidays", requireAdmin, async (req, res) => {
    try {
      const { date, name } = req.body;
      const holiday = await storage.createHoliday({ date: parseJstDate(date), name });
      res.json(holiday);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/holidays/:id", requireAdmin, async (req, res) => {
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

      const slot = (await resolveRequestSlotReference(db, request))?.slot;
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

      const slot = (await resolveRequestSlotReference(db, request))?.slot;
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
