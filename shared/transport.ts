import { z } from "zod";
import { formatJstDate, parseJstDate } from "./jst";

export const directionLabels = { OUTBOUND: "行き不要", INBOUND: "帰り不要", BOTH: "往復不要" } as const;
export type TransportDirection = keyof typeof directionLabels;
export const transportDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  try { return formatJstDate(parseJstDate(value)) === value; } catch { return false; }
}, "実在する日付を指定してください（日本時間）");
export const transportProfileSchema = z.object({
  childName: z.string().trim().min(1).max(80).regex(/^[ぁ-ゖー 　]+$/, "名前はひらがなで入力してください"),
  classBand: z.enum(["初級", "中級", "上級"]),
  courseId: z.string().min(1), outbound: z.boolean(), inbound: z.boolean(),
}).strict().refine((value) => value.outbound || value.inbound, "利用する送迎を選択してください");
export const transportNoticeSchema = z.object({
  profileId: z.string().min(1), serviceDate: transportDateSchema,
  direction: z.enum(["OUTBOUND", "INBOUND", "BOTH"]),
  note: z.string().trim().max(300, "補足は300文字以内で入力してください").default(""),
  status: z.enum(["ACTIVE", "CANCELLED"]), expectedVersion: z.number().int().min(0),
}).strict();
export type TransportProfileView = {
  id: string; childName: string; classBand: string; courseId: string;
  outbound: boolean; inbound: boolean; active: boolean;
};
export type TransportNoticeView = {
  id: string; profileId: string; serviceDate: string; direction: TransportDirection;
  note: string; status: "ACTIVE" | "CANCELLED"; version: number;
  acknowledgedVersion: number | null; updatedAt: string;
};
export type TransportDay = {
  eligible: boolean; reason: string | null; lessonTime: string | null;
  editable: boolean; deadlineAt: string | null; editingReason: string | null;
  today: string; notice: TransportNoticeView | null;
};
export type StaffTransportNotice = TransportNoticeView & {
  childName: string; classBand: string; lessonTime: string | null; attendanceWarning: string | null;
};
