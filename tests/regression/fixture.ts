import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import EmbeddedPostgres from "embedded-postgres";
import { build } from "esbuild";
import bcrypt from "bcryptjs";
import pg from "pg";
import * as schema from "../../shared/schema";
import { addJstDays, formatJstDate, parseJstDate, parseJstDateTime } from "../../shared/jst";
import { buildCanonicalSlotId } from "../../shared/slotId";
import { cleanEnvironment } from "./environment.mjs";

const require = createRequire(import.meta.url);
const { generateDrizzleJson, generateMigration } = require("drizzle-kit/api");
const ROOT = path.resolve(import.meta.dirname, "../..");
export const PASSWORD = "Synthetic-regression-only-2026!";
export const CHILD_A = "ごうせいてすと あおい";
export const CHILD_B = "ごうせいてすと はる";

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

export async function createSchoolFixture(ui = false) {
  // No caller-supplied URL, port, data directory, or existing server is accepted.
  const port = await freePort();
  const root = await mkdtemp(path.join(tmpdir(), "hamasui-regression-"));
  const dataDir = path.join(root, "pg");
  const password = randomUUID();
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  const embedded = new EmbeddedPostgres({
    databaseDir: dataDir, port, user: "postgres", password,
    authMethod: "scram-sha-256", persistent: false, createPostgresUser: false,
    postgresFlags: ["-h", "127.0.0.1", "-c", "unix_socket_directories=", "-c", "timezone=UTC"],
    onLog() {}, onError(error) { console.error(error); },
  });
  let pool: pg.Pool | undefined;
  let child: ChildProcess | undefined;
  const setClock = async (iso: string | null) => {
    if (!child) return;
    const id = randomUUID();
    await new Promise<void>((resolve) => {
      const listener = (message: any) => {
        if (message?.type === "clock-ready" && message.id === id) { child!.off("message", listener); resolve(); }
      };
      child!.on("message", listener);
      child!.send({ type: "clock", iso, id });
    });
  };
  const bundle = path.join(ROOT, ".regression", `server-${randomUUID()}.mjs`);
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    await pool?.end();
    await embedded.stop();
    await rm(root, { recursive: true, force: true });
    await rm(bundle, { force: true });
  };
  try {
    await embedded.initialise();
    await embedded.start();
    pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
    const owned = await pool.query("SELECT current_database() AS db, current_setting('data_directory') AS dir, host(inet_server_addr()) AS host, inet_server_port() AS port");
    assert.equal(owned.rows[0].db, "postgres");
    assert.equal(await realpath(owned.rows[0].dir), await realpath(dataDir));
    assert.equal(owned.rows[0].host, "127.0.0.1");
    assert.equal(owned.rows[0].port, port);
    // Derive the empty test database from the checked-in schema, not a production snapshot.
    const desired = generateDrizzleJson(schema);
    const { transportProfiles, transportNotices, ...beforeTransport } = schema;
    for (const statement of await generateMigration(generateDrizzleJson({}), generateDrizzleJson(beforeTransport))) {
      await pool.query(statement);
    }
    // Exercise the deliverable migration against the previous schema, only after ownership checks above.
    await pool.query(await readFile(path.join(ROOT, "db/local-migrations/20261002_transport.sql"), "utf8"));
    const tableNames = Object.values(desired.tables).map((table: any) => `"${table.name.replaceAll('"', '""')}"`);
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const dates = {
      original: formatJstDate(addJstDays(new Date(), 7)),
      makeup: formatJstDate(addJstDays(new Date(), 8)),
      later: formatJstDate(addJstDays(new Date(), 9)),
      past: formatJstDate(addJstDays(new Date(), -1)),
    };
    const ids = {
      original: buildCanonicalSlotId(dates.original, "10:00", "初級"),
      sibling: buildCanonicalSlotId(dates.original, "11:00", "中級"),
      available: buildCanonicalSlotId(dates.makeup, "10:00", "初級"),
      full: buildCanonicalSlotId(dates.makeup, "11:00", "初級"),
      closed: buildCanonicalSlotId(dates.makeup, "12:00", "初級"),
      later: buildCanonicalSlotId(dates.later, "10:00", "初級"),
      past: buildCanonicalSlotId(dates.past, "10:00", "初級"),
    };
    const reset = async () => {
      await setClock(null);
      await pool!.query(`TRUNCATE ${tableNames.join(", ")} RESTART IDENTITY CASCADE`);
      await pool!.query("INSERT INTO global_settings(id, makeup_window_days) VALUES (1, 30)");
      await pool!.query("INSERT INTO admin_credentials(id,password_hash) VALUES (1,$1)", [passwordHash]);
      await pool!.query("INSERT INTO coach_credentials(id,login_id,password_hash) VALUES (1,'synthetic-coach',$1)", [passwordHash]);
      for (const [key, id] of Object.entries(ids)) {
        const date = key === "past" ? dates.past : key === "later" ? dates.later : ["original", "sibling"].includes(key) ? dates.original : dates.makeup;
        const time = id.split("_")[1];
        await pool!.query(`INSERT INTO class_slots(id,date,start_time,course_label,class_band,is_closed,capacity_limit,capacity_current,lesson_start_date_time)
          VALUES ($1,$2,$3,'合成回帰テスト',$4,$5,$6,$7,$8)`, [id,
          parseJstDate(date).toISOString(), time, key === "sibling" ? "中級" : "初級", key === "closed",
          key === "available" ? 3 : 10, key === "full" ? 10 : key === "available" ? 2 : 5,
          parseJstDateTime(date, time).toISOString()]);
      }
      child?.send({ type: "clear-deliveries" });
    };
    await reset();
    await mkdir(path.dirname(bundle), { recursive: true });
    const built = await build({
      entryPoints: [path.join(ROOT, "tests/regression/server.ts")], outfile: bundle,
      platform: "node", target: "node20", bundle: true, format: "esm", packages: "external",
      metafile: true, plugins: [{ name: "test-email-sink", setup(build) {
        build.onResolve({ filter: /^\.\/email-service$/ }, () => ({ path: path.join(ROOT, "tests/regression/email-sink.ts") }));
      } }],
    });
    assert.ok(!Object.keys(built.metafile!.inputs).some((name) => /server\/(email-service|resend-client|scheduler)\.ts$/.test(name)));
    child = fork(bundle, [], {
      cwd: ROOT, execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: { ...cleanEnvironment(), DATABASE_URL: databaseUrl, SESSION_SECRET: randomUUID(), REGRESSION_UI: ui ? "1" : "0" },
    });
    let childLogs = "";
    child.stdout?.on("data", (value) => { childLogs += value; });
    child.stderr?.on("data", (value) => { childLogs += value; });
    const serverPort = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Local app startup timed out: ${childLogs}`)), 30_000);
      child!.once("error", reject);
      child!.once("exit", () => { clearTimeout(timer); reject(new Error(`Local app exited: ${childLogs}`)); });
      child!.on("message", (message: any) => {
        if (message?.type === "ready") { clearTimeout(timer); resolve(message.port); }
      });
    });
    const baseURL = `http://127.0.0.1:${serverPort}`;
    const api = async (route: string, body?: unknown, cookie?: string) => {
      assert.ok(route.startsWith("/api/") && !route.includes("://"));
      const response = await fetch(baseURL + route, {
        method: body === undefined ? "GET" : "POST", redirect: "error",
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000),
      });
      return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
    };
    const input = (childName = CHILD_A, overrides = {}) => ({
      childName, classBand: "初級", absentDateISO: dates.original, originalSlotId: ids.original, ...overrides,
    });
    return {
      baseURL, pool, dates, ids, reset, dispose, api, input, setClock,
      async absence(childName = CHILD_A, overrides = {}) {
        const result = await api("/api/absences", { ...input(childName), reportType: "ABSENCE", ...overrides });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        return result.body;
      },
      booking(absenceId: string, childName = CHILD_A, toSlotId = ids.available, overrides = {}) {
        return { ...input(childName), absenceId, toSlotId, ...overrides };
      },
      async expireSessions() { await pool!.query("UPDATE admin_sessions SET expire = now() - interval '1 day'"); },
      async deliveries() {
        return await new Promise<any[]>((resolve) => {
          const listener = (message: any) => {
            if (message?.type === "deliveries") { child!.off("message", listener); resolve(message.value); }
          };
          child!.on("message", listener);
          child!.send({ type: "deliveries" });
        });
      },
    };
  } catch (error) {
    await dispose().catch(() => undefined);
    throw error;
  }
}
export type SchoolFixture = Awaited<ReturnType<typeof createSchoolFixture>>;
