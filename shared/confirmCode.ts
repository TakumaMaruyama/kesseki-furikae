export const CONFIRM_CODE_LENGTH = 6;
export const CONFIRM_CODE_GENERATION_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const CONFIRM_CODE_PATTERN = /^[A-Z0-9]{6}$/;

export function normalizeConfirmCode(value: string): string {
  return value.trim().toUpperCase();
}

export function sanitizeConfirmCodeInput(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CONFIRM_CODE_LENGTH);
}

export function isValidConfirmCode(value: string): boolean {
  return CONFIRM_CODE_PATTERN.test(normalizeConfirmCode(value));
}
