import assert from "node:assert/strict";
import {
  generateConfirmCodeCandidate,
  generateUniqueAbsenceConfirmCode,
} from "../server/confirmCode.ts";
import {
  CONFIRM_CODE_GENERATION_ALPHABET,
  isValidConfirmCode,
  normalizeConfirmCode,
  sanitizeConfirmCodeInput,
} from "../shared/confirmCode.ts";

async function main() {
  for (let index = 0; index < 1_000; index += 1) {
    const candidate = generateConfirmCodeCandidate();
    assert.equal(candidate.length, 6);
    assert.match(candidate, /^[A-HJ-NP-Z2-9]{6}$/);
    for (const character of candidate) {
      assert.ok(CONFIRM_CODE_GENERATION_ALPHABET.includes(character));
    }
  }

  assert.equal(normalizeConfirmCode(" ab2c3d "), "AB2C3D");
  assert.equal(sanitizeConfirmCodeInput("a-b 2c3d!!"), "AB2C3D");
  assert.equal(isValidConfirmCode("AB2C3D"), true);
  assert.equal(isValidConfirmCode("010101"), true);
  assert.equal(isValidConfirmCode("AB2C3"), false);
  assert.equal(isValidConfirmCode("AB2C3-"), false);

  const existingCodes = new Set(["123456"]);
  const candidates = ["123456", "654321"];
  const confirmCode = await generateUniqueAbsenceConfirmCode(null, {
    generateCandidate: () => candidates.shift() || "000000",
    hasConfirmCode: async (candidate) => existingCodes.has(candidate),
  });
  assert.equal(confirmCode, "654321");

  await assert.rejects(
    generateUniqueAbsenceConfirmCode(null, {
      generateCandidate: () => "TOO-LONG",
      hasConfirmCode: async () => false,
    }),
    /CONFIRM_CODE_INVALID/,
  );

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
