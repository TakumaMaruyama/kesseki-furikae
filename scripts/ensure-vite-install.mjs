import { spawnSync } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function isMissingViteChunkError(error) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = `${error.message}\n${error.stack ?? ""}`;
  return (
    message.includes("node_modules/vite/dist/node/chunks") &&
    message.includes("ERR_MODULE_NOT_FOUND")
  );
}

async function canImportVite() {
  try {
    await import("vite");
    return true;
  } catch (error) {
    if (!isMissingViteChunkError(error)) {
      throw error;
    }

    console.warn(
      "[vite:repair] Broken Vite install detected. Reinstalling dependencies with npm ci...",
    );
    return false;
  }
}

if (!(await canImportVite())) {
  const result = spawnSync(npmCommand, ["ci"], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  if (!(await canImportVite())) {
    throw new Error("[vite:repair] Vite import still failed after npm ci.");
  }

  console.log("[vite:repair] Dependency reinstall completed.");
}
