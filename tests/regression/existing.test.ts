import test from "node:test";
import { execFileSync } from "node:child_process";
import { cleanEnvironment } from "./environment.mjs";

// Run the existing checks unchanged; do not copy their assertions into the new suite.
for (const name of ["confirm-code", "new-enrollees", "create-slot", "parent-slot-calendar", "slot-form-ux", "daily-status-reasons", "error-handler", "security-hardening", "slot-ops"]) {
  test(`existing verify-${name}`, () => {
    execFileSync(process.execPath, ["--import", "tsx", `scripts/verify-${name}.ts`], {
      env: cleanEnvironment(), stdio: "pipe", timeout: 30_000,
    });
  });
}
