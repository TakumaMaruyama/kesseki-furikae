import { randomBytes, randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { absences } from "@shared/schema";

// Legacy: 6-digit numeric codes (still present in DB for existing absences)
const LEGACY_CONFIRM_CODE_LENGTH = 6;
const LEGACY_CONFIRM_CODE_SPACE = 10 ** LEGACY_CONFIRM_CODE_LENGTH;

// New high-entropy codes: 8 characters from a 32-char alphabet (ambiguous chars removed)
// Entropy: 32^8 ≈ 1.1 trillion combinations
const NEW_CONFIRM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const NEW_CONFIRM_CODE_LENGTH = 8;

const DEFAULT_MAX_ATTEMPTS = 20;
const ABSENCE_CONFIRM_CODE_UNIQUE_INDEX = "UQ_absences_confirm_code";

function generateLegacyConfirmCodeCandidate(): string {
  return randomInt(0, LEGACY_CONFIRM_CODE_SPACE).toString().padStart(LEGACY_CONFIRM_CODE_LENGTH, "0");
}

function generateNewConfirmCodeCandidate(): string {
  const bytes = randomBytes(NEW_CONFIRM_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < NEW_CONFIRM_CODE_LENGTH; i++) {
    code += NEW_CONFIRM_CODE_ALPHABET[bytes[i] % NEW_CONFIRM_CODE_ALPHABET.length];
  }
  return code;
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

/**
 * Returns true if the given string looks like a valid confirm code format.
 * Accepts both legacy 6-digit numeric codes and new 8-char alphanumeric codes.
 */
export function isValidConfirmCodeFormat(code: string): boolean {
  if (!code) return false;
  // Legacy format: exactly 6 digits
  if (/^\d{6}$/.test(code)) return true;
  // New format: exactly 8 uppercase alphanumeric chars (from our alphabet)
  if (/^[A-Z0-9]{8}$/.test(code)) return true;
  return false;
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
  const generateCandidate = options?.generateCandidate ?? generateNewConfirmCodeCandidate;
  const hasConfirmCode = options?.hasConfirmCode ?? ((confirmCode: string) => hasAbsenceConfirmCode(executor, confirmCode));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const confirmCode = generateCandidate();
    if (!(await hasConfirmCode(confirmCode))) {
      return confirmCode;
    }
  }

  throw new Error("CONFIRM_CODE_EXHAUSTED");
}
