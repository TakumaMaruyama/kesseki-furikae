import {
  users,
  children,
  courses,
  classSlots,
  absences,
  requests,
  holidays,
  globalSettings,
  adminCredentials,
  type User,
  type UpsertUser,
  type Child,
  type InsertChild,
  type Course,
  type InsertCourse,
  type ClassSlot,
  type InsertClassSlot,
  type Absence,
  type InsertAbsence,
  type Request,
  type InsertRequest,
  type Holiday,
  type InsertHoliday,
  type GlobalSettings,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, lte, lt, asc, desc, sql } from "drizzle-orm";

export interface IStorage {
  // User operations (required for Replit Auth and local auth)
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  createLocalUser(email: string, passwordHash: string, displayName: string): Promise<User>;
  updateUserProfile(id: string, displayName: string): Promise<User | undefined>;
  setResetToken(userId: string, token: string, expiry: Date): Promise<void>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;
  clearResetToken(userId: string): Promise<void>;

  // Children operations
  getChildrenByUserId(userId: string): Promise<Child[]>;
  getChildById(id: string): Promise<Child | undefined>;
  createChild(data: InsertChild): Promise<Child>;
  updateChild(id: string, data: Partial<InsertChild>): Promise<Child | undefined>;
  deleteChild(id: string): Promise<boolean>;
  countChildrenByUserId(userId: string): Promise<number>;

  // Courses operations
  getAllCourses(): Promise<Course[]>;
  getActiveCourses(): Promise<Course[]>;
  getCourseById(id: string): Promise<Course | undefined>;
  createCourse(data: InsertCourse): Promise<Course>;
  updateCourse(id: string, data: Partial<InsertCourse>): Promise<Course | undefined>;
  deleteCourse(id: string): Promise<boolean>;

  // ClassSlot operations
  getClassSlotById(id: string): Promise<ClassSlot | undefined>;
  getClassSlotsByDateRange(startDate: Date, endDate: Date): Promise<ClassSlot[]>;
  getClassSlotsByDate(date: Date): Promise<ClassSlot[]>;
  getClassSlotsByDateAndClassBand(date: Date, classBand: string): Promise<ClassSlot[]>;
  getAllClassSlots(): Promise<ClassSlot[]>;
  createClassSlot(data: InsertClassSlot): Promise<ClassSlot>;
  updateClassSlot(id: string, data: Partial<InsertClassSlot>): Promise<ClassSlot | undefined>;
  deleteClassSlot(id: string): Promise<boolean>;
  countFutureSlots(): Promise<number>;

  // Absence operations
  getAbsenceById(id: string): Promise<Absence | undefined>;
  getAbsenceByResumeToken(token: string): Promise<Absence | undefined>;
  getAbsencesByConfirmCode(confirmCode: string): Promise<Absence[]>;
  getAbsencesByOriginalSlotId(slotId: string): Promise<Absence[]>;
  createAbsence(data: InsertAbsence): Promise<Absence>;
  updateAbsence(id: string, data: Partial<InsertAbsence>): Promise<Absence | undefined>;
  getAllAbsences(): Promise<Absence[]>;

  // Request operations
  getRequestById(id: string): Promise<Request | undefined>;
  getRequestsByConfirmCode(confirmCode: string): Promise<Request[]>;
  getRequestsBySlotId(slotId: string): Promise<Request[]>;
  getRequestsByAbsenceId(absenceId: string): Promise<Request[]>;
  getConfirmedRequestsBySlotId(slotId: string): Promise<Request[]>;
  getConfirmedRequests(): Promise<Request[]>;
  getRequestByDeclineToken(token: string): Promise<Request | undefined>;
  getRequestByCancelToken(token: string): Promise<Request | undefined>;
  createRequest(data: InsertRequest): Promise<Request>;
  updateRequest(id: string, data: Partial<InsertRequest>): Promise<Request | undefined>;
  deleteRequest(id: string): Promise<boolean>;

  // Holiday operations
  getAllHolidays(): Promise<Holiday[]>;
  getHolidayByDate(date: Date): Promise<Holiday | undefined>;
  createHoliday(data: InsertHoliday): Promise<Holiday>;
  deleteHoliday(id: string): Promise<boolean>;

  // Global settings
  getGlobalSettings(): Promise<GlobalSettings | undefined>;
  updateGlobalSettings(data: Partial<GlobalSettings>): Promise<GlobalSettings | undefined>;

  // Admin credentials
  getAdminPasswordHash(): Promise<string | undefined>;
  setAdminPasswordHash(hash: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async createLocalUser(email: string, passwordHash: string, displayName: string): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        displayName,
        authProvider: "local",
      })
      .returning();
    return user;
  }

  async updateUserProfile(id: string, displayName: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ displayName, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.resetToken, token));
    return user;
  }

  async setResetToken(userId: string, token: string, expiry: Date): Promise<void> {
    await db
      .update(users)
      .set({ resetToken: token, resetTokenExpiry: expiry, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await db
      .update(users)
      .set({ passwordHash, resetToken: null, resetTokenExpiry: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async clearResetToken(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ resetToken: null, resetTokenExpiry: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  // Children operations
  async getChildrenByUserId(userId: string): Promise<Child[]> {
    return db.select().from(children).where(eq(children.userId, userId)).orderBy(asc(children.createdAt));
  }

  async getChildById(id: string): Promise<Child | undefined> {
    const [child] = await db.select().from(children).where(eq(children.id, id));
    return child;
  }

  async createChild(data: InsertChild): Promise<Child> {
    const [child] = await db.insert(children).values({
      ...data,
      id: sql`gen_random_uuid()`,
    }).returning();
    return child;
  }

  async updateChild(id: string, data: Partial<InsertChild>): Promise<Child | undefined> {
    const [child] = await db
      .update(children)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(children.id, id))
      .returning();
    return child;
  }

  async deleteChild(id: string): Promise<boolean> {
    const result = await db.delete(children).where(eq(children.id, id)).returning();
    return result.length > 0;
  }

  async countChildrenByUserId(userId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` }).from(children).where(eq(children.userId, userId));
    return Number(result[0]?.count || 0);
  }

  // Courses operations
  async getAllCourses(): Promise<Course[]> {
    return db.select().from(courses).orderBy(asc(courses.dayOfWeek), asc(courses.startTime));
  }

  async getActiveCourses(): Promise<Course[]> {
    return db.select().from(courses).where(eq(courses.isActive, true)).orderBy(asc(courses.dayOfWeek), asc(courses.startTime));
  }

  async getCourseById(id: string): Promise<Course | undefined> {
    const [course] = await db.select().from(courses).where(eq(courses.id, id));
    return course;
  }

  async createCourse(data: InsertCourse): Promise<Course> {
    const [course] = await db.insert(courses).values({
      ...data,
      id: sql`gen_random_uuid()`,
    }).returning();
    return course;
  }

  async updateCourse(id: string, data: Partial<InsertCourse>): Promise<Course | undefined> {
    const [course] = await db
      .update(courses)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(courses.id, id))
      .returning();
    return course;
  }

  async deleteCourse(id: string): Promise<boolean> {
    const result = await db.delete(courses).where(eq(courses.id, id)).returning();
    return result.length > 0;
  }

  // ClassSlot operations
  async getClassSlotById(id: string): Promise<ClassSlot | undefined> {
    const [slot] = await db.select().from(classSlots).where(eq(classSlots.id, id));
    return slot;
  }

  async getClassSlotsByDateRange(startDate: Date, endDate: Date): Promise<ClassSlot[]> {
    return db.select().from(classSlots)
      .where(and(gte(classSlots.date, startDate), lte(classSlots.date, endDate)))
      .orderBy(asc(classSlots.date), asc(classSlots.startTime));
  }

  async getClassSlotsByDate(date: Date): Promise<ClassSlot[]> {
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    return db.select().from(classSlots)
      .where(and(gte(classSlots.date, date), lt(classSlots.date, nextDay)))
      .orderBy(asc(classSlots.startTime));
  }

  async getClassSlotsByDateAndClassBand(date: Date, classBand: string): Promise<ClassSlot[]> {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    return db.select().from(classSlots)
      .where(and(
        gte(classSlots.date, dayStart),
        lte(classSlots.date, dayEnd),
        eq(classSlots.classBand, classBand)
      ))
      .orderBy(asc(classSlots.startTime));
  }

  async getAllClassSlots(): Promise<ClassSlot[]> {
    return db.select().from(classSlots).orderBy(asc(classSlots.date), asc(classSlots.startTime));
  }

  async createClassSlot(data: InsertClassSlot): Promise<ClassSlot> {
    const [slot] = await db.insert(classSlots).values(data).returning();
    return slot;
  }

  async updateClassSlot(id: string, data: Partial<InsertClassSlot>): Promise<ClassSlot | undefined> {
    const [slot] = await db
      .update(classSlots)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(classSlots.id, id))
      .returning();
    return slot;
  }

  async deleteClassSlot(id: string): Promise<boolean> {
    const result = await db.delete(classSlots).where(eq(classSlots.id, id)).returning();
    return result.length > 0;
  }

  async countFutureSlots(): Promise<number> {
    const now = new Date();
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(classSlots)
      .where(gte(classSlots.lessonStartDateTime, now));
    return Number(result[0]?.count || 0);
  }

  // Absence operations
  async getAbsenceById(id: string): Promise<Absence | undefined> {
    const [absence] = await db.select().from(absences).where(eq(absences.id, id));
    return absence;
  }

  async getAbsenceByResumeToken(token: string): Promise<Absence | undefined> {
    const [absence] = await db.select().from(absences).where(eq(absences.resumeToken, token));
    return absence;
  }

  async getAbsencesByConfirmCode(confirmCode: string): Promise<Absence[]> {
    return db.select().from(absences)
      .where(eq(absences.confirmCode, confirmCode))
      .orderBy(desc(absences.createdAt));
  }

  async getAbsencesByOriginalSlotId(slotId: string): Promise<Absence[]> {
    return db.select().from(absences).where(eq(absences.originalSlotId, slotId));
  }

  async createAbsence(data: InsertAbsence): Promise<Absence> {
    const [absence] = await db.insert(absences).values(data).returning();
    return absence;
  }

  async updateAbsence(id: string, data: Partial<InsertAbsence>): Promise<Absence | undefined> {
    const [absence] = await db
      .update(absences)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(absences.id, id))
      .returning();
    return absence;
  }

  async getAllAbsences(): Promise<Absence[]> {
    return db.select().from(absences).orderBy(desc(absences.createdAt));
  }

  // Request operations
  async getRequestById(id: string): Promise<Request | undefined> {
    const [request] = await db.select().from(requests).where(eq(requests.id, id));
    return request;
  }

  async getRequestsByConfirmCode(confirmCode: string): Promise<Request[]> {
    return db.select().from(requests)
      .where(eq(requests.confirmCode, confirmCode))
      .orderBy(desc(requests.createdAt));
  }

  async getRequestsBySlotId(slotId: string): Promise<Request[]> {
    return db.select().from(requests).where(eq(requests.toSlotId, slotId));
  }

  async getRequestsByAbsenceId(absenceId: string): Promise<Request[]> {
    return db.select().from(requests).where(eq(requests.absenceId, absenceId));
  }

  async getConfirmedRequestsBySlotId(slotId: string): Promise<Request[]> {
    return db.select().from(requests)
      .where(and(eq(requests.toSlotId, slotId), eq(requests.status, "確定")));
  }

  async getConfirmedRequests(): Promise<Request[]> {
    return db.select().from(requests)
      .where(eq(requests.status, "確定"))
      .orderBy(asc(requests.toSlotStartDateTime));
  }

  async getRequestByDeclineToken(token: string): Promise<Request | undefined> {
    const [request] = await db.select().from(requests).where(eq(requests.declineToken, token));
    return request;
  }

  async getRequestByCancelToken(token: string): Promise<Request | undefined> {
    const [request] = await db.select().from(requests).where(eq(requests.cancelToken, token));
    return request;
  }

  async createRequest(data: InsertRequest): Promise<Request> {
    const [request] = await db.insert(requests).values(data).returning();
    return request;
  }

  async updateRequest(id: string, data: Partial<InsertRequest>): Promise<Request | undefined> {
    const [request] = await db
      .update(requests)
      .set(data)
      .where(eq(requests.id, id))
      .returning();
    return request;
  }

  async deleteRequest(id: string): Promise<boolean> {
    const result = await db.delete(requests).where(eq(requests.id, id)).returning();
    return result.length > 0;
  }

  // Holiday operations
  async getAllHolidays(): Promise<Holiday[]> {
    return db.select().from(holidays).orderBy(asc(holidays.date));
  }

  async getHolidayByDate(date: Date): Promise<Holiday | undefined> {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const [holiday] = await db.select().from(holidays)
      .where(and(gte(holidays.date, dayStart), lte(holidays.date, dayEnd)));
    return holiday;
  }

  async createHoliday(data: InsertHoliday): Promise<Holiday> {
    const [holiday] = await db.insert(holidays).values({
      ...data,
      id: sql`gen_random_uuid()`,
    }).returning();
    return holiday;
  }

  async deleteHoliday(id: string): Promise<boolean> {
    const result = await db.delete(holidays).where(eq(holidays.id, id)).returning();
    return result.length > 0;
  }

  // Global settings
  async getGlobalSettings(): Promise<GlobalSettings | undefined> {
    const [settings] = await db.select().from(globalSettings).where(eq(globalSettings.id, 1));
    return settings;
  }

  async updateGlobalSettings(data: Partial<GlobalSettings>): Promise<GlobalSettings | undefined> {
    const existing = await this.getGlobalSettings();
    if (!existing) {
      const [settings] = await db.insert(globalSettings).values({ id: 1, ...data }).returning();
      return settings;
    }
    const [settings] = await db
      .update(globalSettings)
      .set(data)
      .where(eq(globalSettings.id, 1))
      .returning();
    return settings;
  }

  // Admin credentials
  async getAdminPasswordHash(): Promise<string | undefined> {
    const [admin] = await db.select().from(adminCredentials).where(eq(adminCredentials.id, 1));
    return admin?.passwordHash;
  }

  async setAdminPasswordHash(hash: string): Promise<void> {
    const existing = await db.select().from(adminCredentials).where(eq(adminCredentials.id, 1));
    if (existing.length === 0) {
      await db.insert(adminCredentials).values({ id: 1, passwordHash: hash });
    } else {
      await db.update(adminCredentials).set({ passwordHash: hash, updatedAt: new Date() }).where(eq(adminCredentials.id, 1));
    }
  }
}

export const storage = new DatabaseStorage();
