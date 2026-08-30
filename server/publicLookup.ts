import type { absences, requests } from "@shared/schema";

type AbsenceRecord = typeof absences.$inferSelect;
type RequestRecord = typeof requests.$inferSelect;

export function toPublicLookupAbsence(absence: AbsenceRecord) {
  return {
    id: absence.id,
    childName: absence.childName,
    declaredClassBand: absence.declaredClassBand,
    reportType: absence.reportType,
    absentDate: absence.absentDate,
    makeupDeadline: absence.makeupDeadline,
    makeupStatus: absence.makeupStatus,
  };
}

export function toPublicLookupRequest(request: RequestRecord) {
  return {
    id: request.id,
    childName: request.childName,
    declaredClassBand: request.declaredClassBand,
    toSlotId: request.toSlotId,
    toSlotStartDateTime: request.toSlotStartDateTime,
    status: request.status,
  };
}
