import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { absences } from "@shared/schema";

const CONFIRM_CODE_LENGTH = 6;
const CONFIRM_CODE_SPACE = 10 ** CONFIRM_CODE_LENGTH;
const DEFAULT_MAX_ATTEMPTS = 20;
const ABSENCE_CONFIRM_CODE_UNIQUE_INDEX = "UQ_absences_confirm_code";

function generateConfirmCodeCandidate(): string {
  return randomInt(0, CONFIRM_CODE_SPACE).toString().padStart(CONFIRM_CODE_LENGTH, "0");
}

async function hasAbsenceConfirmCode(executor: any, confirmCode: string): Promise<boolean> {
  const [existing] = await executor
    .select({ id: absences.id })
    .from(absences)
    .where(eq(absences.confirmCode, confirmCode))
    .limit(1);

  return !!existing;
}

export function isAbsenceConfirmCodeUniqueViolation(error: any): boolean {
  const constraintName = error?.constraint_name ?? error?.constraint;
  return error?.code === "23505" &&
    typeof constraintName === "string" &&
    constraintName.toLowerCase() === ABSENCE_CONFIRM_CODE_UNIQUE_INDEX.toLowerCase();
}

export async function generateUniqueAbsenceConfirmCode(
  executor: any,
  options?: {
    maxAttempts?: number;
    generateCandidate?: () => string;
    hasConfirmCode?: (confirmCode: string) => Promise<boolean>;
  },
): Promise<string> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const generateCandidate = options?.generateCandidate ?? generateConfirmCodeCandidate;
  const hasConfirmCode = options?.hasConfirmCode ?? ((confirmCode: string) => hasAbsenceConfirmCode(executor, confirmCode));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const confirmCode = generateCandidate();
    if (!(await hasConfirmCode(confirmCode))) {
      return confirmCode;
    }
  }

  throw new Error("CONFIRM_CODE_EXHAUSTED");
}
