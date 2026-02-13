import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const REQUIRED_SCRIPTS = ["slots:audit-time", "slots:repair-time"] as const;

type PackageJson = {
  scripts?: Record<string, string>;
};

async function main() {
  const packageJsonPath = resolve(process.cwd(), "package.json");
  const raw = await readFile(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw) as PackageJson;

  const scripts = pkg.scripts ?? {};
  const missing = REQUIRED_SCRIPTS.filter((scriptName) => !scripts[scriptName]);

  if (missing.length > 0) {
    console.error(`[ops:verify-slot-scripts] Missing scripts: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log("[ops:verify-slot-scripts] OK");
  for (const scriptName of REQUIRED_SCRIPTS) {
    console.log(`- ${scriptName}: ${scripts[scriptName]}`);
  }
}

main().catch((error) => {
  console.error("[ops:verify-slot-scripts] Failed:", error);
  process.exit(1);
});
