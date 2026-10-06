-- Generated from shared/schema.ts. Local synthetic database only; not applied at startup.
BEGIN;
CREATE TABLE "transport_notices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" varchar NOT NULL,
	"service_date" date NOT NULL,
	"direction" varchar NOT NULL,
	"note" varchar(300) DEFAULT '' NOT NULL,
	"status" varchar DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"acknowledged_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_notice_direction" CHECK ("transport_notices"."direction" IN ('OUTBOUND', 'INBOUND', 'BOTH')),
	CONSTRAINT "transport_notice_status" CHECK ("transport_notices"."status" IN ('ACTIVE', 'CANCELLED')),
	CONSTRAINT "transport_notice_version" CHECK ("transport_notices"."version" > 0)
);

CREATE TABLE "transport_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"child_name" varchar NOT NULL,
	"class_band" varchar NOT NULL,
	"course_id" varchar NOT NULL,
	"outbound" boolean NOT NULL,
	"inbound" boolean NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"code_hash" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_profile_legs" CHECK ("transport_profiles"."outbound" OR "transport_profiles"."inbound")
);

ALTER TABLE "transport_notices" ADD CONSTRAINT "transport_notices_profile_id_transport_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."transport_profiles"("id") ON DELETE no action ON UPDATE no action;
CREATE UNIQUE INDEX "transport_notice_child_date" ON "transport_notices" USING btree ("profile_id","service_date");
CREATE INDEX "transport_notice_date" ON "transport_notices" USING btree ("service_date");
CREATE UNIQUE INDEX "transport_profile_code" ON "transport_profiles" USING btree ("code_hash");
COMMIT;
