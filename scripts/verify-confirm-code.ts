import assert from "node:assert/strict";
import { generateUniqueAbsenceConfirmCode } from "../server/confirmCode.ts";

async function main() {
  const existingCodes = new Set(["123456"]);
  const candidates = ["123456", "654321"];
  const confirmCode = await generateUniqueAbsenceConfirmCode(null, {
    generateCandidate: () => candidates.shift() || "000000",
    hasConfirmCode: async (candidate) => existingCodes.has(candidate),
  });
  assert.equal(confirmCode, "654321");

  await assert.rejects(
    generateUniqueAbsenceConfirmCode(null, {
      maxAttempts: 2,
      generateCandidate: () => "111111",
      hasConfirmCode: async () => true,
    }),
    /CONFIRM_CODE_EXHAUSTED/,
  );

  console.log("verify-confirm-code: ok");
}

main().catch((error) => {
  console.error("verify-confirm-code: failed");
  console.error(error);
  process.exitCode = 1;
});
