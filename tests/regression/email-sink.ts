// Test-only replacement of the delivery boundary. No recipient or message leaves the fixture.
export const deliveries: Array<{ kind: string; args: unknown[] }> = [];
const record = (kind: string) => async (...args: unknown[]) => { deliveries.push({ kind, args }); };
export const sendConfirmationEmail = record("confirmation");
export const sendExpiredEmail = record("expired");
export const sendAbsenceConfirmationEmail = record("absence");
export const sendMakeupConfirmationEmail = record("makeup");
export const sendCancellationEmail = record("absence-cancel");
export const sendRequestCancellationEmail = record("booking-cancel");
