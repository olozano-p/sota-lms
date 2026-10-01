CREATE TABLE "enrollment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"cohort_id" uuid,
	"source" text NOT NULL,
	"external_id" text,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "entitlement" CASCADE;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_cohort_id_cohort_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."cohort"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_person_course_cohort_source_idx" ON "enrollment" USING btree ("person_id","course_id",coalesce("cohort_id", '00000000-0000-0000-0000-000000000000'::uuid),"source");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_source_external_id_idx" ON "enrollment" USING btree ("source","external_id") WHERE "enrollment"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "enrollment_person_idx" ON "enrollment" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "enrollment_course_idx" ON "enrollment" USING btree ("course_id");