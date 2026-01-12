import { pgTable, varchar, integer, timestamp, text, index, jsonb, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
  capacityLimit: integer("capacity_limit").notNull(),
  capacityCurrent: integer("capacity_current").notNull(),
  capacityMakeupUsed: integer("capacity_makeup_used").default(0),
  waitlistCount: integer("waitlist_count").default(0),
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

// Absences
export const absences = pgTable("absences", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id"),
  childId: varchar("child_id"),
  childName: varchar("child_name").notNull(),
  declaredClassBand: varchar("declared_class_band").notNull(),
  absentDate: timestamp("absent_date").notNull(),
  originalSlotId: varchar("original_slot_id").notNull(),
  contactEmail: varchar("contact_email"),
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
]);

export const insertRequestSchema = createInsertSchema(requests).omit({
  createdAt: true,
});
export type InsertRequest = z.infer<typeof insertRequestSchema>;
export type Request = typeof requests.$inferSelect;

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
  declaredClassBand: z.enum(["初級", "中級", "上級"]),
  absentDate: z.date(),
  originalSlotId: z.string(),
  contactEmail: z.string().email().nullable(),
  resumeToken: z.string(),
  makeupDeadline: z.date(),
  makeupStatus: z.enum(["PENDING", "MAKEUP_CONFIRMED", "EXPIRED"]),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createAbsenceRequestSchema = z.object({
  childId: z.string().optional(),
  childName: z.string().min(1, "お子様の名前を入力してください"),
  declaredClassBand: z.enum(["初級", "中級", "上級"], {
    required_error: "クラス帯を選択してください"
  }),
  absentDateISO: z.string().min(1, "欠席日を選択してください"),
  originalSlotId: z.string().min(1, "欠席するレッスン枠を選択してください"),
  contactEmail: z.string().email("正しいメールアドレスを入力してください").optional().or(z.literal("")),
});

export const classSlotSchema = z.object({
  id: z.string(),
  date: z.date(),
  startTime: z.string(),
  courseLabel: z.string(),
  classBand: z.enum(["初級", "中級", "上級"]),
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
  declaredClassBand: z.enum(["初級", "中級", "上級"]),
  absentDate: z.date(),
  toSlotId: z.string(),
  status: z.enum(["確定", "却下", "期限切れ"]),
  contactEmail: z.string().email().nullable(),
  confirmToken: z.string().nullable(),
  declineToken: z.string().nullable(),
  toSlotStartDateTime: z.date(),
  createdAt: z.date(),
});

export const searchSlotsRequestSchema = z.object({
  childName: z.string().min(1, "お子様の名前を入力してください"),
  declaredClassBand: z.enum(["初級", "中級", "上級"], {
    required_error: "クラス帯を選択してください"
  }),
  absentDateISO: z.string().min(1, "欠席日を選択してください"),
});

export const bookRequestSchema = z.object({
  absenceId: z.string().optional(),
  childId: z.string().optional(),
  childName: z.string().min(1),
  declaredClassBand: z.enum(["初級", "中級", "上級"]),
  absentDateISO: z.string(),
  toSlotId: z.string(),
});

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
  recurringWeeks: z.number().min(1).max(52).optional(),
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
  name: z.string().min(1, "お子様の名前を入力してください"),
  courseId: z.string().optional(),
  classBand: z.enum(["初級", "中級", "上級"]).optional(),
});

export const updateChildRequestSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "お子様の名前を入力してください").optional(),
  courseId: z.string().nullable().optional(),
  classBand: z.enum(["初級", "中級", "上級"]).nullable().optional(),
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
export type SearchSlotsRequest = z.infer<typeof searchSlotsRequestSchema>;
export type BookRequest = z.infer<typeof bookRequestSchema>;
export type UpdateSlotCapacityRequest = z.infer<typeof updateSlotCapacityRequestSchema>;
export type CreateSlotRequest = z.infer<typeof createSlotRequestSchema>;
export type UpdateSlotRequest = z.infer<typeof updateSlotRequestSchema>;
export type DeleteSlotRequest = z.infer<typeof deleteSlotRequestSchema>;
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
};
