import { sql } from "drizzle-orm";
import { db } from "./db";
import { log } from "./vite";

const COMPAT_MIGRATION_STATEMENTS = [
  `ALTER TABLE class_slots ADD COLUMN IF NOT EXISTS is_closed boolean NOT NULL DEFAULT false`,
  `ALTER TABLE absences ADD COLUMN IF NOT EXISTS reason text`,
  `ALTER TABLE absences ADD COLUMN IF NOT EXISTS report_type varchar NOT NULL DEFAULT 'ABSENCE'`,
  `ALTER TABLE absences ADD COLUMN IF NOT EXISTS source_type varchar NOT NULL DEFAULT 'NORMAL'`,
  `ALTER TABLE absences ADD COLUMN IF NOT EXISTS closure_event_id varchar`,
  `CREATE TABLE IF NOT EXISTS closure_events (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar NOT NULL,
    shared_code varchar NOT NULL UNIQUE,
    usage_limit integer NOT NULL,
    usage_used integer NOT NULL DEFAULT 0,
    expires_at timestamp NOT NULL,
    is_archived boolean NOT NULL DEFAULT false,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS closure_event_slots (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    closure_event_id varchar NOT NULL REFERENCES closure_events(id) ON DELETE cascade,
    slot_id varchar NOT NULL REFERENCES class_slots(id) ON DELETE cascade,
    created_at timestamp DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS IDX_closure_events_expires_at ON closure_events (expires_at)`,
  `CREATE INDEX IF NOT EXISTS IDX_closure_events_is_archived ON closure_events (is_archived)`,
  `CREATE INDEX IF NOT EXISTS IDX_closure_event_slots_event_id ON closure_event_slots (closure_event_id)`,
  `CREATE INDEX IF NOT EXISTS IDX_closure_event_slots_slot_id ON closure_event_slots (slot_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS UQ_closure_event_slots_event_slot ON closure_event_slots (closure_event_id, slot_id)`,
  `CREATE TABLE IF NOT EXISTS trial_participants (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_name varchar NOT NULL,
    grade varchar NOT NULL,
    swim_level varchar NOT NULL,
    slot_id varchar NOT NULL REFERENCES class_slots(id) ON DELETE cascade,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS IDX_trial_participants_slot_id ON trial_participants (slot_id)`,
  `CREATE INDEX IF NOT EXISTS IDX_trial_participants_created_at ON trial_participants (created_at)`,
  `CREATE TABLE IF NOT EXISTS new_enrollees (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    child_name varchar NOT NULL,
    grade varchar,
    class_band varchar,
    joined_at timestamp NOT NULL,
    course_id varchar REFERENCES courses(id) ON DELETE set null,
    course_name_snapshot varchar NOT NULL,
    target_day_of_week varchar NOT NULL,
    target_start_time varchar NOT NULL,
    source_trial_participant_id varchar REFERENCES trial_participants(id) ON DELETE set null,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS IDX_new_enrollees_joined_at ON new_enrollees (joined_at)`,
  `CREATE INDEX IF NOT EXISTS IDX_new_enrollees_target_day_of_week ON new_enrollees (target_day_of_week)`,
  `CREATE INDEX IF NOT EXISTS IDX_new_enrollees_source_trial_participant_id ON new_enrollees (source_trial_participant_id)`,
  `CREATE TABLE IF NOT EXISTS slot_id_aliases (
    legacy_slot_id varchar PRIMARY KEY,
    canonical_slot_id varchar NOT NULL REFERENCES class_slots(id) ON DELETE cascade,
    source varchar NOT NULL,
    created_at timestamp DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS IDX_slot_id_aliases_canonical_slot_id ON slot_id_aliases (canonical_slot_id)`,
  `DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT confirm_code
      FROM absences
      GROUP BY confirm_code
      HAVING COUNT(*) > 1
    ) THEN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS UQ_absences_confirm_code ON absences (confirm_code)';
    END IF;
  END $$`,
  `DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'absences_closure_event_id_closure_events_id_fk'
    ) THEN
      ALTER TABLE absences
      ADD CONSTRAINT absences_closure_event_id_closure_events_id_fk
      FOREIGN KEY (closure_event_id)
      REFERENCES closure_events(id)
      ON DELETE set null;
    END IF;
  END $$`,
];

export async function ensureRuntimeSchema(): Promise<void> {
  for (const statement of COMPAT_MIGRATION_STATEMENTS) {
    await db.execute(sql.raw(statement));
  }

  log("runtime schema compatibility checks completed", "schema");
}
