---
name: Drizzle publish name divergence
description: Why Replit Publish migration validation fails on dev↔prod object-name mismatch and how to fix it
---
# Replit Publish fails on dev↔prod object-name divergence

When Replit Publish reports "Failed to validate database migrations / Unexpected error" and the generated migration is dominated by DROP/CREATE of constraints and indexes (not real structural changes), the cause is that dev and prod databases hold the SAME structure under DIFFERENT object NAMES. The publish diff tries to rename everything and the validator chokes.

**Why it happens here:** some tables were historically created in prod via raw SQL/Prisma (Postgres-default names: `*_fkey`, `*_key`, lowercase `idx_*`/`uq_*`) while dev got Drizzle-default names (`*_fk`, `*_unique`, uppercase `IDX_*`/`UQ_*`). drizzle-kit also emits a cosmetic no-op `ALTER ... SET DATA TYPE timestamp` for `timestamp` vs `timestamp(6)` even when both are precision 6.

**Fix (dev-side only, supported):** make `shared/schema.ts` declare the SAME names prod already uses — explicit `foreignKey({ name: "..._fkey" })`, `.unique("..._key")`, lowercase `index("idx_...")`/`uniqueIndex("uq_...")`. Then `npm run db:push` renames dev objects to match prod, collapsing the publish diff to only genuine additive changes. Never run DDL on prod or write migration/startup/deploy scripts — prod schema changes go through Publish only.

**How to verify before telling user to re-publish:** `npm run db:push` twice → second run says "No changes detected"; query `pg_constraint`/`pg_indexes` in both `development` and `production` (read-only) and confirm the names match for the affected tables.

**Why:** Replit's publish validator can't safely process a large rename-heavy diff; minimizing the diff to additive-only is the robust path. The tradeoff is non-idiomatic explicit names in the schema for legacy tables — that's intentional, to keep dev==prod.
