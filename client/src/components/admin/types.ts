import type { ClassSlot, Course } from "@shared/schema";

export type LessonWithStatus = ClassSlot & {
    absenceCount: number;
    makeupCount: number;
};

export type LessonStatus = {
    slot: ClassSlot;
    absences: any[];
    makeupRequests: any[];
};

export type DashboardStats = {
    todayAbsences: number;
    todayMakeups: number;
    pendingAbsences: number;
    futureSlots: number;
    todayLessons: number;
};

export type EnrichedAbsence = {
    id: string;
    childName: string;
    declaredClassBand: string;
    absentDate: string;
    makeupStatus: string;
    confirmCode: string;
    courseLabel: string | null;
    startTime: string | null;
    createdAt: string;
};

export type EnrichedRequest = {
    id: string;
    childName: string;
    declaredClassBand: string;
    absentDate: string;
    status: string;
    toSlotDate: string | null;
    toSlotStartTime: string | null;
    courseLabel: string | null;
    createdAt: string;
};

export type CourseDialogProps = {
    course: Course | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (data: { name: string; dayOfWeek: string; startTime: string }) => void;
};

export type SlotDialogProps = {
    slot: ClassSlot | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (data: any) => void;
};

export const DAY_OPTIONS = ["月曜", "火曜", "水曜", "木曜", "金曜", "土曜", "日曜"];
export const HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => String(9 + i).padStart(2, '0'));
export const MINUTE_OPTIONS = ["00", "30"];
