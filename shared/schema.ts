import { pgTable, varchar, integer, timestamp, text, index, jsonb, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

const HIRAGANA_NAME_REGEX = /^[ぁ-ゖー 　]+$/;
const CLASS_BAND_VALUES = ["初級", "中級", "上級"] as const;

function normalizeDeclaredClassBandAlias(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeDeclaredClassBandAlias);
  }

  if (!value || typeof value !== "object" || value instanceof Date) {
    return value;
  }

  const input = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  for (const [key, entryValue] of Object.entries(input)) {
    const normalizedKey =
      key === "classBand" && !("declaredClassBand" in input)
        ? "declaredClassBand"
        : key;
    normalized[normalizedKey] = normalizeDeclaredClassBandAlias(entryValue);
  }

  return normalized;
}

const classBandEnum = z.enum(CLASS_BAND_VALUES);
const requiredClassBandEnum = z.enum(CLASS_BAND_VALUES, {
  required_error: "クラス帯を選択してください",
});

export const DEFAULT_RECURRING_SLOT_WEEKS = 52;
export const MAX_RECURRING_SLOT_WEEKS = 156;

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// User storage table for Replit Auth and local auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  passwordHash: varchar("password_hash"),
  authProvider: varchar("auth_provider").default("google"),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  displayName: varchar("display_name"),
  resetToken: varchar("reset_token"),
  resetTokenExpiry: timestamp("reset_token_expiry"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Children table - linked to users
export const children = pgTable("children", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name").notNull(),
  courseId: varchar("course_id").references(() => courses.id),
  classBand: varchar("class_band"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_children_user_id").on(table.userId),
]);

export const insertChildSchema = createInsertSchema(children).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertChild = z.infer<typeof insertChildSchema>;
export type Child = typeof children.$inferSelect;

// Courses table - represents lesson day/time patterns (e.g., "月曜 16:00")
export const courses = pgTable("courses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  dayOfWeek: varchar("day_of_week").notNull(),
  startTime: varchar("start_time").notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCourseSchema = createInsertSchema(courses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCourse = z.infer<typeof insertCourseSchema>;
export type Course = typeof courses.$inferSelect;

// Global settings
export const globalSettings = pgTable("global_settings", {
  id: integer("id").primaryKey().default(1),
  makeupWindowDays: integer("makeup_window_days").default(30),
  cutoffTime: varchar("cutoff_time").default("16:00"),
});

export type GlobalSettings = typeof globalSettings.$inferSelect;

// Class slots
export const classSlots = pgTable("class_slots", {
  id: varchar("id").primaryKey(),
  date: timestamp("date").notNull(),
  startTime: varchar("start_time").notNull(),
  courseLabel: varchar("course_label").notNull(),
  classBand: varchar("class_band").notNull(),
  isClosed: boolean("is_closed").notNull().default(false),
  capacityLimit: integer("capacity_limit").notNull(),
  capacityCurrent: integer("capacity_current").notNull(),
  capacityMakeupUsed: integer("capacity_makeup_used").notNull().default(0),
  waitlistCount: integer("waitlist_count").notNull().default(0),
  lessonStartDateTime: timestamp("lesson_start_date_time").notNull(),
  lastNotifiedRequestId: varchar("last_notified_request_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_class_slots_date").on(table.date),
  index("IDX_class_slots_class_band").on(table.classBand),
]);

export const insertClassSlotSchema = createInsertSchema(classSlots).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertClassSlot = z.infer<typeof insertClassSlotSchema>;
export type ClassSlot = typeof classSlots.$inferSelect;
export type ClassSlotWithTrialParticipantCount = ClassSlot & {
  trialParticipantCount: number;
};

export const slotIdAliases = pgTable("slot_id_aliases", {
  legacySlotId: varchar("legacy_slot_id").primaryKey(),
  canonicalSlotId: varchar("canonical_slot_id").notNull(),
  source: varchar("source").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_slot_id_aliases_canonical_slot_id").on(table.canonicalSlotId),
  foreignKey({
    columns: [table.canonicalSlotId],
    foreignColumns: [classSlots.id],
    name: "slot_id_aliases_canonical_slot_id_fkey",
  }).onDelete("cascade"),
]);

export const insertSlotIdAliasSchema = createInsertSchema(slotIdAliases).omit({
  createdAt: true,
});
export type InsertSlotIdAlias = z.infer<typeof insertSlotIdAliasSchema>;
export type SlotIdAlias = typeof slotIdAliases.$inferSelect;

// Closure events (temporary class cancellation handling)
export const closureEvents = pgTable("closure_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  sharedCode: varchar("shared_code").notNull().unique("closure_events_shared_code_key"),
  usageLimit: integer("usage_limit").notNull(),
  usageUsed: integer("usage_used").notNull().default(0),
  expiresAt: timestamp("expires_at").notNull(),
  isArchived: boolean("is_archived").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_closure_events_expires_at").on(table.expiresAt),
  index("idx_closure_events_is_archived").on(table.isArchived),
]);

export const insertClosureEventSchema = createInsertSchema(closureEvents).omit({
  id: true,
  usageUsed: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertClosureEvent = z.infer<typeof insertClosureEventSchema>;
export type ClosureEvent = typeof closureEvents.$inferSelect;

export const closureEventSlots = pgTable("closure_event_slots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  closureEventId: varchar("closure_event_id").notNull(),
  slotId: varchar("slot_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_closure_event_slots_event_id").on(table.closureEventId),
  index("idx_closure_event_slots_slot_id").on(table.slotId),
  uniqueIndex("uq_closure_event_slots_event_slot").on(table.closureEventId, table.slotId),
  foreignKey({
    columns: [table.closureEventId],
    foreignColumns: [closureEvents.id],
    name: "closure_event_slots_closure_event_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.slotId],
    foreignColumns: [classSlots.id],
    name: "closure_event_slots_slot_id_fkey",
  }).onDelete("cascade"),
]);

export const insertClosureEventSlotSchema = createInsertSchema(closureEventSlots).omit({
  id: true,
  createdAt: true,
});
export type InsertClosureEventSlot = z.infer<typeof insertClosureEventSlotSchema>;
export type ClosureEventSlot = typeof closureEventSlots.$inferSelect;

// Absences
export const absences = pgTable("absences", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id"),
  childId: varchar("child_id"),
  childName: varchar("child_name").notNull(),
  declaredClassBand: varchar("declared_class_band").notNull(),
  reportType: varchar("report_type").notNull().default("ABSENCE"),
  absentDate: timestamp("absent_date").notNull(),
  originalSlotId: varchar("original_slot_id").notNull(),
  contactEmail: varchar("contact_email"),
  reason: text("reason"),
  sourceType: varchar("source_type").notNull().default("NORMAL"),
  closureEventId: varchar("closure_event_id").references(() => closureEvents.id, { onDelete: "set null" }),
  resumeToken: varchar("resume_token").unique().notNull(),
  confirmCode: varchar("confirm_code", { length: 6 }).notNull(),
  makeupDeadline: timestamp("makeup_deadline").notNull(),
  makeupStatus: varchar("makeup_status").default("PENDING").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_absences_resume_token").on(table.resumeToken),
  index("IDX_absences_makeup_status").on(table.makeupStatus),
  index("IDX_absences_original_slot_id").on(table.originalSlotId),
  index("IDX_absences_confirm_code").on(table.confirmCode),
  index("IDX_absences_absent_date_created_at").on(table.absentDate, table.createdAt),
]);

export const insertAbsenceSchema = createInsertSchema(absences).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertAbsence = z.infer<typeof insertAbsenceSchema>;
export type Absence = typeof absences.$inferSelect;

// Requests
export const requests = pgTable("requests", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id"),
  childId: varchar("child_id"),
  absenceId: varchar("absence_id"),
  childName: varchar("child_name").notNull(),
  declaredClassBand: varchar("declared_class_band").notNull(),
  absentDate: timestamp("absent_date").notNull(),
  toSlotId: varchar("to_slot_id").notNull(),
  status: varchar("status").notNull(),
  contactEmail: varchar("contact_email"),
  confirmToken: varchar("confirm_token"),
  declineToken: varchar("decline_token"),
  cancelToken: varchar("cancel_token"),
  confirmCode: varchar("confirm_code", { length: 6 }),
  toSlotStartDateTime: timestamp("to_slot_start_date_time").notNull(),
  confirmationEmailSentAt: timestamp("confirmation_email_sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("IDX_requests_to_slot_id").on(table.toSlotId),
  index("IDX_requests_status").on(table.status),
  index("IDX_requests_absence_id").on(table.absenceId),
  index("IDX_requests_confirm_code").on(table.confirmCode),
  index("IDX_requests_to_slot_start_created_at").on(table.toSlotStartDateTime, table.createdAt),
]);

export const insertRequestSchema = createInsertSchema(requests).omit({
  createdAt: true,
});
export type InsertRequest = z.infer<typeof insertRequestSchema>;
export type Request = typeof requests.$inferSelect;

// Trial participants (admin-managed)
export const trialParticipants = pgTable("trial_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  participantName: varchar("participant_name").notNull(),
  grade: varchar("grade").notNull(),
  swimLevel: varchar("swim_level").notNull(),
  slotId: varchar("slot_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_trial_participants_slot_id").on(table.slotId),
  index("idx_trial_participants_created_at").on(table.createdAt),
  foreignKey({
    columns: [table.slotId],
    foreignColumns: [classSlots.id],
    name: "trial_participants_slot_id_fkey",
  }).onDelete("cascade"),
]);

export const insertTrialParticipantSchema = createInsertSchema(trialParticipants).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTrialParticipant = z.infer<typeof insertTrialParticipantSchema>;
export type TrialParticipant = typeof trialParticipants.$inferSelect;

export const newEnrollees = pgTable("new_enrollees", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  childName: varchar("child_name").notNull(),
  grade: varchar("grade"),
  classBand: varchar("class_band"),
  joinedAt: timestamp("joined_at").notNull(),
  courseId: varchar("course_id").references(() => courses.id, { onDelete: "set null" }),
  courseNameSnapshot: varchar("course_name_snapshot").notNull(),
  targetDayOfWeek: varchar("target_day_of_week").notNull(),
  targetStartTime: varchar("target_start_time").notNull(),
  sourceTrialParticipantId: varchar("source_trial_participant_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_new_enrollees_joined_at").on(table.joinedAt),
  index("IDX_new_enrollees_target_day_of_week").on(table.targetDayOfWeek),
  index("IDX_new_enrollees_source_trial_participant_id").on(table.sourceTrialParticipantId),
  foreignKey({
    columns: [table.sourceTrialParticipantId],
    foreignColumns: [trialParticipants.id],
    name: "new_enrollees_source_trial_participant_id_fk",
  }).onDelete("set null"),
]);

export const insertNewEnrolleeSchema = createInsertSchema(newEnrollees).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertNewEnrollee = z.infer<typeof insertNewEnrolleeSchema>;
export type NewEnrollee = typeof newEnrollees.$inferSelect;


// Holidays
export const holidays = pgTable("holidays", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: timestamp("date").notNull().unique(),
  name: varchar("name"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("IDX_holidays_date").on(table.date),
]);

export const insertHolidaySchema = createInsertSchema(holidays).omit({
  id: true,
  createdAt: true,
});
export type InsertHoliday = z.infer<typeof insertHolidaySchema>;
export type Holiday = typeof holidays.$inferSelect;

// Admin credentials for password-based admin login
export const adminCredentials = pgTable("admin_credentials", {
  id: integer("id").primaryKey().default(1),
  passwordHash: varchar("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Shared coach credentials for read-only daily status access
export const coachCredentials = pgTable("coach_credentials", {
  id: integer("id").primaryKey().default(1),
  loginId: varchar("login_id").notNull().unique(),
  passwordHash: varchar("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type CoachCredential = typeof coachCredentials.$inferSelect;

// Zod schemas for API validation
export const globalSettingsSchema = z.object({
  id: z.number(),
  makeupWindowDays: z.number(),
  cutoffTime: z.string(),
});

export const absenceSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  childId: z.string().nullable(),
  childName: z.string(),
  declaredClassBand: classBandEnum,
  reportType: z.enum(["ABSENCE", "LATE"]),
  absentDate: z.date(),
  originalSlotId: z.string(),
  contactEmail: z.string().email().nullable(),
  reason: z.string().nullable(),
  sourceType: z.enum(["NORMAL", "CLOSURE_CODE"]),
  closureEventId: z.string().nullable(),
  resumeToken: z.string(),
  makeupDeadline: z.date(),
  makeupStatus: z.enum(["PENDING", "MAKEUP_CONFIRMED", "EXPIRED", "CANCELLED"]),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const absenceEntryObjectSchema = z.object({
  childId: z.string().optional(),
  childName: z
    .string()
    .trim()
    .min(1, "お子様の名前を入力してください")
    .regex(HIRAGANA_NAME_REGEX, "お子様の名前はひらがなで入力してください（空白・ー可）"),
  declaredClassBand: requiredClassBandEnum,
  absentDateISO: z.string().min(1, "欠席日を選択してください"),
  originalSlotId: z.string().min(1, "欠席するレッスン枠を選択してください"),
});

export const absenceEntrySchema = z.preprocess(
  normalizeDeclaredClassBandAlias,
  absenceEntryObjectSchema,
);

export const createAbsenceRequestSchema = z.preprocess(
  normalizeDeclaredClassBandAlias,
  absenceEntryObjectSchema.extend({
    reportType: z.enum(["ABSENCE", "LATE"]).default("ABSENCE"),
    contactEmail: z.string().email("正しいメールアドレスを入力してください").optional().or(z.literal("")),
    reason: z.string().trim().max(200, "理由は200文字以内で入力してください").optional(),
  }),
);

export const createAbsencesBatchRequestSchema = z.preprocess(
  normalizeDeclaredClassBandAlias,
  z.object({
    reportType: z.enum(["ABSENCE", "LATE"]).default("ABSENCE"),
    items: z.array(absenceEntryObjectSchema)
      .min(1, "少なくとも1名分の欠席情報を入力してください")
      .max(5, "一度に登録できるのは5名までです"),
    contactEmail: z.string().email("正しいメールアドレスを入力してください").optional().or(z.literal("")),
    reason: z.string().trim().max(200, "理由は200文字以内で入力してください").optional(),
  }),
);

export const validateClosureCodeRequestSchema = z.object({
  sharedCode: z.string().trim().min(1, "共通コードを入力してください"),
});

export const redeemClosureCodeRequestSchema = z.preprocess(
  normalizeDeclaredClassBandAlias,
  z.object({
    sharedCode: z.string().trim().min(1, "共通コードを入力してください"),
    items: z.array(absenceEntryObjectSchema)
      .min(1, "少なくとも1名分の振替権を入力してください")
      .max(5, "一度に登録できるのは5名までです"),
    contactEmail: z.string().email("正しいメールアドレスを入力してください").optional().or(z.literal("")),
    reason: z.string().trim().max(200, "理由は200文字以内で入力してください").optional(),
  }),
);

export const createClosureEventRequestSchema = z.object({
  name: z.string().trim().min(1, "イベント名を入力してください").max(100, "イベント名は100文字以内で入力してください"),
  sharedCode: z
    .string()
    .trim()
    .min(4, "共通コードは4文字以上で入力してください")
    .max(30, "共通コードは30文字以内で入力してください")
    .regex(/^[A-Za-z0-9_-]+$/, "共通コードは半角英数字・ハイフン・アンダースコアのみ使用できます"),
  usageLimit: z.number().int().min(1, "利用上限は1以上で設定してください").max(500, "利用上限は500以下で設定してください"),
  expiresAtISO: z.string().min(1, "有効期限を入力してください"),
  slotIds: z.array(z.string().min(1)).min(1, "対象枠を1件以上選択してください"),
});

export const updateClosureEventSlotsRequestSchema = z.object({
  slotIds: z.array(z.string().min(1)).min(1, "対象枠を1件以上選択してください"),
});

export const classSlotSchema = z.object({
  id: z.string(),
  date: z.date(),
  startTime: z.string(),
  courseLabel: z.string(),
  classBand: classBandEnum,
  isClosed: z.boolean(),
  capacityLimit: z.number(),
  capacityCurrent: z.number(),
  capacityMakeupUsed: z.number(),
  lessonStartDateTime: z.date(),
  lastNotifiedRequestId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const requestSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  childId: z.string().nullable(),
  childName: z.string(),
  declaredClassBand: classBandEnum,
  absentDate: z.date(),
  toSlotId: z.string(),
  status: z.enum(["確定", "却下", "期限切れ", "キャンセル", "辞退"]),
  contactEmail: z.string().email().nullable(),
  confirmToken: z.string().nullable(),
  declineToken: z.string().nullable(),
  toSlotStartDateTime: z.date(),
  createdAt: z.date(),
});

export const searchSlotsRequestSchema = z.preprocess(
  normalizeDeclaredClassBandAlias,
  z.object({
    childName: z.string().min(1, "お子様の名前を入力してください"),
    declaredClassBand: requiredClassBandEnum,
    absentDateISO: z.string().min(1, "欠席日を選択してください"),
  }),
);

export const bookRequestSchema = z.preprocess(
  normalizeDeclaredClassBandAlias,
  z.object({
    absenceId: z.string().optional(),
    childId: z.string().optional(),
    childName: z.string().min(1),
    declaredClassBand: requiredClassBandEnum,
    absentDateISO: z.string(),
    toSlotId: z.string(),
  }),
);

export const updateSlotCapacityRequestSchema = z.object({
  slotId: z.string(),
  capacityCurrent: z.number().optional(),
  capacityMakeupUsed: z.number().optional(),
});

export const createSlotRequestSchema = z.object({
  date: z.string(),
  startTime: z.string(),
  courseLabel: z.string().min(1, "コース名を入力してください"),
  classBands: z.array(z.enum(["初級", "中級", "上級"])).min(1, "少なくとも1つのクラス帯を選択してください"),
  classBandCapacities: z.record(z.object({
    capacityLimit: z.number().min(0),
    capacityCurrent: z.number().min(0),
  })),
  isRecurring: z.boolean().optional(),
  recurringWeeks: z.number().min(1).max(MAX_RECURRING_SLOT_WEEKS).optional(),
});

export const updateSlotRequestSchema = z.object({
  id: z.string(),
  date: z.string().optional(),
  startTime: z.string().optional(),
  courseLabel: z.string().optional(),
  classBand: z.enum(["初級", "中級", "上級"]).optional(),
  capacityLimit: z.number().optional(),
  capacityCurrent: z.number().optional(),
  applyToFuture: z.boolean().optional(),
});

export const deleteSlotRequestSchema = z.object({
  id: z.string(),
  applyToFuture: z.boolean().optional(),
});

const trialParticipantFieldSchema = z.string().trim().min(1).max(100);

export const createTrialParticipantRequestSchema = z.object({
  participantName: trialParticipantFieldSchema,
  grade: trialParticipantFieldSchema,
  swimLevel: trialParticipantFieldSchema,
  slotId: z.string().trim().min(1, "参加枠を選択してください"),
});

export const updateTrialParticipantRequestSchema = z.object({
  participantName: trialParticipantFieldSchema.optional(),
  grade: trialParticipantFieldSchema.optional(),
  swimLevel: trialParticipantFieldSchema.optional(),
  slotId: z.string().trim().min(1, "参加枠を選択してください").optional(),
}).refine((value) => (
  value.participantName !== undefined ||
  value.grade !== undefined ||
  value.swimLevel !== undefined ||
  value.slotId !== undefined
), {
  message: "更新項目を指定してください",
});

export const cancelAbsenceRequestSchema = z.object({
  resumeToken: z.string(),
});

export const cancelRequestSchema = z.object({
  requestId: z.string(),
  cancelToken: z.string(),
});

// Child management schemas
export const createChildRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "お子様の名前を入力してください")
    .regex(HIRAGANA_NAME_REGEX, "お子様の名前はひらがなで入力してください（空白・ー可）"),
  courseId: z.string().optional(),
  classBand: classBandEnum.optional(),
});

export const updateChildRequestSchema = z.object({
  id: z.string(),
  name: z
    .string()
    .trim()
    .min(1, "お子様の名前を入力してください")
    .regex(HIRAGANA_NAME_REGEX, "お子様の名前はひらがなで入力してください（空白・ー可）")
    .optional(),
  courseId: z.string().nullable().optional(),
  classBand: classBandEnum.nullable().optional(),
});

// Course management schemas
export const createCourseRequestSchema = z.object({
  name: z.string().min(1, "コース名を入力してください"),
  dayOfWeek: z.string().min(1, "曜日を選択してください"),
  startTime: z.string().min(1, "開始時間を入力してください"),
});

export const updateCourseRequestSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  dayOfWeek: z.string().optional(),
  startTime: z.string().optional(),
  isActive: z.boolean().optional(),
});

// User profile update schema
export const updateUserProfileSchema = z.object({
  displayName: z.string().min(1, "お名前を入力してください"),
});

// Local auth schemas
export const registerUserSchema = z.object({
  email: z.string().email("正しいメールアドレスを入力してください"),
  password: z.string().min(6, "パスワードは6文字以上で入力してください"),
  displayName: z.string().min(1, "お名前を入力してください"),
});

export const loginUserSchema = z.object({
  email: z.string().email("正しいメールアドレスを入力してください"),
  password: z.string().min(1, "パスワードを入力してください"),
  rememberMe: z.boolean().optional().default(false),
});

export type CreateAbsenceRequest = z.infer<typeof createAbsenceRequestSchema>;
export type AbsenceEntryRequest = z.infer<typeof absenceEntrySchema>;
export type CreateAbsencesBatchRequest = z.infer<typeof createAbsencesBatchRequestSchema>;
export type ValidateClosureCodeRequest = z.infer<typeof validateClosureCodeRequestSchema>;
export type RedeemClosureCodeRequest = z.infer<typeof redeemClosureCodeRequestSchema>;
export type CreateClosureEventRequest = z.infer<typeof createClosureEventRequestSchema>;
export type UpdateClosureEventSlotsRequest = z.infer<typeof updateClosureEventSlotsRequestSchema>;
export type SearchSlotsRequest = z.infer<typeof searchSlotsRequestSchema>;
export type BookRequest = z.infer<typeof bookRequestSchema>;
export type UpdateSlotCapacityRequest = z.infer<typeof updateSlotCapacityRequestSchema>;
export type CreateSlotRequest = z.infer<typeof createSlotRequestSchema>;
export type UpdateSlotRequest = z.infer<typeof updateSlotRequestSchema>;
export type DeleteSlotRequest = z.infer<typeof deleteSlotRequestSchema>;
export type CreateTrialParticipantRequest = z.infer<typeof createTrialParticipantRequestSchema>;
export type UpdateTrialParticipantRequest = z.infer<typeof updateTrialParticipantRequestSchema>;
export type CancelAbsenceRequest = z.infer<typeof cancelAbsenceRequestSchema>;
export type CancelRequest = z.infer<typeof cancelRequestSchema>;
export type CreateChildRequest = z.infer<typeof createChildRequestSchema>;
export type UpdateChildRequest = z.infer<typeof updateChildRequestSchema>;
export type CreateCourseRequest = z.infer<typeof createCourseRequestSchema>;
export type UpdateCourseRequest = z.infer<typeof updateCourseRequestSchema>;
export type UpdateUserProfileRequest = z.infer<typeof updateUserProfileSchema>;
export type RegisterUserRequest = z.infer<typeof registerUserSchema>;
export type LoginUserRequest = z.infer<typeof loginUserSchema>;

export type SlotSearchResult = {
  slotId: string;
  date: string;
  startTime: string;
  courseLabel: string;
  classBand: string;
  statusCode: "〇" | "△" | "×";
  statusText: string;
  remainingSlots: number;
  capacityLimit?: number;
  capacityCurrent?: number;
  capacityMakeupUsed?: number;
  trialParticipantCount?: number;
  actualCurrent?: number;
};
