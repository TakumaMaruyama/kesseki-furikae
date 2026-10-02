import { spawn } from "node:child_process";
import { cleanEnvironment } from "../tests/regression/environment.mjs";

// Every entry point starts without ambient database, email, Replit, or auth secrets.
const mode = process.argv[2] || "all";
const suites = {
  existing: ["--import", "tsx", "--test", "tests/regression/existing.test.ts"],
  api: ["--import", "tsx", "--test", "--test-concurrency=1", "tests/regression/api.test.ts"],
  transport: ["--import", "tsx", "--test", "--test-concurrency=1", "tests/regression/transport.test.ts"],
  e2e: ["node_modules/@playwright/test/cli.js", "test", "--config", "playwright.regression.config.ts"],
};
if (mode !== "all" && !(mode in suites)) throw new Error("Use all, existing, api, transport, or e2e");
let failed = false;
for (const suite of mode === "all" ? Object.keys(suites) : [mode]) {
  console.log(`\nRunning regression suite: ${suite}`);
  const extra = process.argv.slice(3);
  const args = suite === "e2e" ? [...suites[suite], ...extra]
    : [...suites[suite].slice(0, -1), ...extra, suites[suite].at(-1)];
  const child = spawn(process.execPath, args, {
    cwd: new URL("..", import.meta.url), env: cleanEnvironment(), stdio: "inherit",
  });
  const forwardSignal = () => child.kill("SIGTERM");
  process.once("SIGINT", forwardSignal);
  process.once("SIGTERM", forwardSignal);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  process.removeListener("SIGINT", forwardSignal);
  process.removeListener("SIGTERM", forwardSignal);
  failed ||= code !== 0;
}
process.exitCode = failed ? 1 : 0;
