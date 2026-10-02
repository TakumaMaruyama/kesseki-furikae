import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import * as schema from "../shared/schema";

// Offline schema diff only. Never imports server/db or reads a database URL.
const require = createRequire(import.meta.url);
const { generateDrizzleJson, generateMigration } = require("drizzle-kit/api");
const { transportProfiles, transportNotices, ...before } = schema;
const statements: string[] = await generateMigration(generateDrizzleJson(before), generateDrizzleJson(schema));
if (statements.some((statement) => /(?:ALTER|DROP) TABLE "(?!transport_)/i.test(statement))) {
  throw new Error("Transport migration must not modify existing tables");
}
const directory = new URL("../db/local-migrations/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("20261002_transport.sql", directory),
  "-- Generated from shared/schema.ts. Local synthetic database only; not applied at startup.\nBEGIN;\n" + statements.join("\n") + "\nCOMMIT;\n");
