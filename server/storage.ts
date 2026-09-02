import {
  users,
  children,
  courses,
  classSlots,
  absences,
  requests,
  trialParticipants,
  newEnrollees,
  holidays,
  globalSettings,
  adminCredentials,
  coachCredentials,
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
  type TrialParticipant,
  type InsertTrialParticipant,
  type NewEnrollee,
  type InsertNewEnrollee,
  type Holiday,
  type InsertHoliday,
  type GlobalSettings,
  type CoachCredential,
} from "@shared/schema";
import { addJstDays, endOfJstDay, startOfJstDay } from "@shared/jst";
import { getDayOfWeekLabelForDate, isNewEnrolleeVisibleOnDate } from "@shared/newEnrolleeVisibility";
import { isSlotStarted } from "@shared/slotDateTime";
import { db } from "./db";
import { eq, and, gte, lte, lt, asc, desc, inArray, sql } from "drizzle-orm";
import { resolveSlotLookupIds, resolveSlotReference } from "./slotIdAliases";

export type TrialParticipantWithSlot = {
  id: string;
  participantName: string;
  grade: string;
  swimLevel: string;
  slotId: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  startTime: string;
  courseLabel: string;
  classBand: string;
  slotDate: Date;
};

export type TrialParticipantSearchResult = {
  id: string;
  participantName: string;
  grade: string;
  swimLevel: string;
  slotId: string;
  slotDate: Date;
  startTime: string;
  courseLabel: string;
  classBand: string;
  createdAt: Date | null;
};

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
  incrementClassSlotMakeup(id: string): Promise<ClassSlot | undefined>;
  decrementClassSlotMakeup(id: string): Promise<ClassSlot | undefined>;
  incrementClassSlotCurrent(id: string): Promise<ClassSlot | undefined>;
  decrementClassSlotCurrent(id: string): Promise<ClassSlot | undefined>;

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

  // Trial participant operations
  getTrialParticipantsByDate(date: Date): Promise<TrialParticipantWithSlot[]>;
  getTrialParticipantCountsBySlotIds(slotIds: string[]): Promise<Record<string, number>>;
  getTrialParticipantById(id: string): Promise<TrialParticipant | undefined>;
  createTrialParticipant(data: InsertTrialParticipant): Promise<TrialParticipant>;
  updateTrialParticipant(id: string, data: Partial<InsertTrialParticipant>): Promise<TrialParticipant | undefined>;
  deleteTrialParticipant(id: string): Promise<boolean>;
  searchTrialParticipants(query: string, limit?: number): Promise<TrialParticipantSearchResult[]>;

  // New enrollee operations
  getNewEnrolleesVisibleOnDate(date: Date): Promise<NewEnrollee[]>;
  getNewEnrolleeById(id: string): Promise<NewEnrollee | undefined>;
  createNewEnrollee(data: InsertNewEnrollee): Promise<NewEnrollee>;
  updateNewEnrollee(id: string, data: Partial<InsertNewEnrollee>): Promise<NewEnrollee | undefined>;
  deleteNewEnrollee(id: string): Promise<boolean>;

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
  getCoachCredential(): Promise<CoachCredential | undefined>;
  upsertCoachCredential(loginId: string, passwordHash: string): Promise<CoachCredential>;
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
    const resolved = await resolveSlotReference(db, id);
    return resolved?.slot;
  }

  async getClassSlotsByDateRange(startDate: Date, endDate: Date): Promise<ClassSlot[]> {
    return db.select().from(classSlots)
      .where(and(gte(classSlots.date, startDate), lte(classSlots.date, endDate)))
      .orderBy(asc(classSlots.date), asc(classSlots.startTime));
  }

  async getClassSlotsByDate(date: Date): Promise<ClassSlot[]> {
    const dayStart = startOfJstDay(date);
    const nextDay = addJstDays(dayStart, 1);
    return db.select().from(classSlots)
      .where(and(gte(classSlots.date, dayStart), lt(classSlots.date, nextDay)))
      .orderBy(asc(classSlots.startTime));
  }

  async getClassSlotsByDateAndClassBand(date: Date, classBand: string): Promise<ClassSlot[]> {
    const dayStart = startOfJstDay(date);
    const dayEnd = endOfJstDay(date);

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
    const scanStart = addJstDays(startOfJstDay(now), -1);
    const slots = await db.select({
      date: classSlots.date,
      startTime: classSlots.startTime,
    })
      .from(classSlots)
      .where(and(
        gte(classSlots.date, scanStart),
        eq(classSlots.isClosed, false),
      ));

    return slots.filter((slot) => !isSlotStarted(slot, now)).length;
  }

  async incrementClassSlotMakeup(id: string): Promise<ClassSlot | undefined> {
    const [slot] = await db
      .update(classSlots)
      .set({
        capacityMakeupUsed: sql`${classSlots.capacityMakeupUsed} + 1`,
        updatedAt: new Date()
      })
      .where(eq(classSlots.id, id))
      .returning();
    return slot;
  }

  async decrementClassSlotMakeup(id: string): Promise<ClassSlot | undefined> {
    const [slot] = await db
      .update(classSlots)
      .set({
        capacityMakeupUsed: sql`GREATEST(0, ${classSlots.capacityMakeupUsed} - 1)`,
        updatedAt: new Date()
      })
      .where(eq(classSlots.id, id))
      .returning();
    return slot;
  }

  async incrementClassSlotCurrent(id: string): Promise<ClassSlot | undefined> {
    const [slot] = await db
      .update(classSlots)
      .set({
        capacityCurrent: sql`${classSlots.capacityCurrent} + 1`,
        updatedAt: new Date()
      })
      .where(eq(classSlots.id, id))
      .returning();
    return slot;
  }

  async decrementClassSlotCurrent(id: string): Promise<ClassSlot | undefined> {
    const [slot] = await db
      .update(classSlots)
      .set({
        capacityCurrent: sql`GREATEST(0, ${classSlots.capacityCurrent} - 1)`,
        updatedAt: new Date()
      })
      .where(eq(classSlots.id, id))
      .returning();
    return slot;
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
    const slotIds = await resolveSlotLookupIds(db, slotId);
    return db.select().from(absences).where(
      and(
        inArray(absences.originalSlotId, slotIds),
        sql`${absences.makeupStatus} NOT IN ('CANCELLED', 'EXPIRED')`
      )
    );
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
    const slotIds = await resolveSlotLookupIds(db, slotId);
    return db.select().from(requests).where(inArray(requests.toSlotId, slotIds));
  }

  async getRequestsByAbsenceId(absenceId: string): Promise<Request[]> {
    return db.select().from(requests).where(eq(requests.absenceId, absenceId));
  }

  async getConfirmedRequestsBySlotId(slotId: string): Promise<Request[]> {
    const slotIds = await resolveSlotLookupIds(db, slotId);
    return db.select().from(requests)
      .where(and(inArray(requests.toSlotId, slotIds), eq(requests.status, "確定")));
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

  // Trial participant operations
  async getTrialParticipantsByDate(date: Date): Promise<TrialParticipantWithSlot[]> {
    const dayStart = startOfJstDay(date);
    const nextDay = addJstDays(dayStart, 1);

    return db
      .select({
        id: trialParticipants.id,
        participantName: trialParticipants.participantName,
        grade: trialParticipants.grade,
        swimLevel: trialParticipants.swimLevel,
        slotId: trialParticipants.slotId,
        createdAt: trialParticipants.createdAt,
        updatedAt: trialParticipants.updatedAt,
        startTime: classSlots.startTime,
        courseLabel: classSlots.courseLabel,
        classBand: classSlots.classBand,
        slotDate: classSlots.date,
      })
      .from(trialParticipants)
      .innerJoin(classSlots, eq(trialParticipants.slotId, classSlots.id))
      .where(and(
        gte(classSlots.date, dayStart),
        lt(classSlots.date, nextDay),
      ))
      .orderBy(asc(classSlots.startTime), asc(trialParticipants.participantName), asc(trialParticipants.createdAt));
  }

  async getTrialParticipantCountsBySlotIds(slotIds: string[]): Promise<Record<string, number>> {
    if (slotIds.length === 0) {
      return {};
    }

    const rows = await db
      .select({
        slotId: trialParticipants.slotId,
        count: sql<number>`count(*)`,
      })
      .from(trialParticipants)
      .where(inArray(trialParticipants.slotId, slotIds))
      .groupBy(trialParticipants.slotId);

    return Object.fromEntries(rows.map((row) => [row.slotId, Number(row.count)]));
  }

  async getTrialParticipantById(id: string): Promise<TrialParticipant | undefined> {
    const [participant] = await db.select().from(trialParticipants).where(eq(trialParticipants.id, id));
    return participant;
  }

  async createTrialParticipant(data: InsertTrialParticipant): Promise<TrialParticipant> {
    const [participant] = await db
      .insert(trialParticipants)
      .values({
        ...data,
        id: sql`gen_random_uuid()`,
      })
      .returning();
    return participant;
  }

  async updateTrialParticipant(id: string, data: Partial<InsertTrialParticipant>): Promise<TrialParticipant | undefined> {
    const [participant] = await db
      .update(trialParticipants)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(trialParticipants.id, id))
      .returning();
    return participant;
  }

  async deleteTrialParticipant(id: string): Promise<boolean> {
    const result = await db.delete(trialParticipants).where(eq(trialParticipants.id, id)).returning();
    return result.length > 0;
  }

  async searchTrialParticipants(query: string, limit = 20): Promise<TrialParticipantSearchResult[]> {
    const normalizedQuery = query.trim();
    const filters = normalizedQuery
      ? [sql`${trialParticipants.participantName} ILIKE ${`%${normalizedQuery}%`}`]
      : [];

    return db
      .select({
        id: trialParticipants.id,
        participantName: trialParticipants.participantName,
        grade: trialParticipants.grade,
        swimLevel: trialParticipants.swimLevel,
        slotId: trialParticipants.slotId,
        slotDate: classSlots.date,
        startTime: classSlots.startTime,
        courseLabel: classSlots.courseLabel,
        classBand: classSlots.classBand,
        createdAt: trialParticipants.createdAt,
      })
      .from(trialParticipants)
      .innerJoin(classSlots, eq(trialParticipants.slotId, classSlots.id))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(classSlots.date), desc(classSlots.startTime), asc(trialParticipants.participantName))
      .limit(limit);
  }

  async getNewEnrolleesVisibleOnDate(date: Date): Promise<NewEnrollee[]> {
    const targetDayOfWeek = getDayOfWeekLabelForDate(date);
    const dayEnd = endOfJstDay(date);
    // The fourth weekly display can be at most 27 days after joining.
    const joinedAtLowerBound = addJstDays(date, -27);

    const candidates = await db
      .select()
      .from(newEnrollees)
      .where(and(
        eq(newEnrollees.targetDayOfWeek, targetDayOfWeek),
        gte(newEnrollees.joinedAt, joinedAtLowerBound),
        lte(newEnrollees.joinedAt, dayEnd),
      ))
      .orderBy(asc(newEnrollees.targetStartTime), asc(newEnrollees.childName), asc(newEnrollees.createdAt));

    return candidates.filter((enrollee) => isNewEnrolleeVisibleOnDate({
      joinedAt: enrollee.joinedAt,
      targetDayOfWeek: enrollee.targetDayOfWeek,
      date,
    }));
  }

  async getNewEnrolleeById(id: string): Promise<NewEnrollee | undefined> {
    const [enrollee] = await db.select().from(newEnrollees).where(eq(newEnrollees.id, id));
    return enrollee;
  }

  async createNewEnrollee(data: InsertNewEnrollee): Promise<NewEnrollee> {
    const [enrollee] = await db
      .insert(newEnrollees)
      .values({ ...data, id: sql`gen_random_uuid()` })
      .returning();
    return enrollee;
  }

  async updateNewEnrollee(id: string, data: Partial<InsertNewEnrollee>): Promise<NewEnrollee | undefined> {
    const [enrollee] = await db
      .update(newEnrollees)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(newEnrollees.id, id))
      .returning();
    return enrollee;
  }

  async deleteNewEnrollee(id: string): Promise<boolean> {
    const result = await db.delete(newEnrollees).where(eq(newEnrollees.id, id)).returning();
    return result.length > 0;
  }

  // Holiday operations
  async getAllHolidays(): Promise<Holiday[]> {
    return db.select().from(holidays).orderBy(asc(holidays.date));
  }

  async getHolidayByDate(date: Date): Promise<Holiday | undefined> {
    const dayStart = startOfJstDay(date);
    const dayEnd = endOfJstDay(date);

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

  // Shared coach credentials
  async getCoachCredential(): Promise<CoachCredential | undefined> {
    const [credential] = await db
      .select()
      .from(coachCredentials)
      .where(eq(coachCredentials.id, 1));
    return credential;
  }

  async upsertCoachCredential(loginId: string, passwordHash: string): Promise<CoachCredential> {
    const existing = await this.getCoachCredential();
    if (!existing) {
      const [credential] = await db
        .insert(coachCredentials)
        .values({ id: 1, loginId, passwordHash })
        .returning();
      return credential;
    }

    const [credential] = await db
      .update(coachCredentials)
      .set({ loginId, passwordHash, updatedAt: new Date() })
      .where(eq(coachCredentials.id, 1))
      .returning();
    return credential;
  }
}

export const storage = new DatabaseStorage();
