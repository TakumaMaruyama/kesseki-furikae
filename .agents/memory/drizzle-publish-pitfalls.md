---
name: Drizzle + Replit Publish migration pitfalls
description: Non-obvious causes of "Failed to validate database migrations" on publish and db:push churn for this Drizzle/Postgres app
---

# Drizzle + Replit Publish / db:push pitfalls

## Schema is the source of truth; no startup DDL, no second migration system
- Replit Publish validates by diffing dev DB vs prod DB; dev is synced from `shared/schema.ts` via `npm run db:push`.
- **Why:** runtime/startup DDL (e.g. an `ensureRuntimeSchema` that runs `CREATE TABLE`/`ALTER`/`DROP INDEX` on boot) and leftover non-Drizzle migration tooling (a `prisma/` dir, even if only used by a standalone seed script) create ambiguity that can surface as "Unexpected error" during publish validation.
- **How to apply:** keep all schema in `shared/schema.ts`; never add startup DDL or deploy hooks; if Prisma/other ORM artifacts exist but the app runtime uses Drizzle (`server/db.ts` → drizzle/postgres-js), remove them with the package tools (uninstall) + delete the dir — do not hand-edit package.json.

## connect-pg-simple session tables must be declared in Drizzle, exactly
- `connect-pg-simple` with `createTableIfMissing: true` auto-creates its session table at runtime (here `admin_sessions`). If the Drizzle schema declares a *different* session table name (e.g. `sessions`) that exists in neither DB, `drizzle-kit push` throws an interactive "create or rename?" prompt that hangs non-interactive post-merge setup.
- The auto-created column type is `json`, **not** `jsonb` — declare `json("sess")` or push will churn an ALTER every run.
- **How to apply:** the Drizzle table name + column types must match exactly what connect-pg-simple created. Removing it from the schema instead would make push want to DROP the live table.

## Drizzle auto-generated FK names > 63 chars cause infinite db:push churn
- Postgres truncates identifiers to 63 chars. Drizzle's default FK name is `<table>_<col>_<reftable>_<refcol>_fk`. When that exceeds 63 chars, Postgres silently drops the `_fk` suffix on creation, so every subsequent `drizzle-kit push` re-detects "drift" and re-issues DROP/ADD CONSTRAINT forever (push reports "Changes applied", never "No changes detected").
- **Fix:** give the FK an explicit name ≤63 chars via `foreignKey({ columns, foreignColumns, name }).onDelete(...)` in the table's callback. Verify stability by running push twice — the second must say "No changes detected".
