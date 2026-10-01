CREATE TABLE "auth_account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "session" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "session" CASCADE;--> statement-breakpoint
ALTER TABLE "person" DROP CONSTRAINT "person_idp_sub_unique";--> statement-breakpoint
ALTER TABLE "person" RENAME COLUMN "idp_sub" TO "external_sub";--> statement-breakpoint
ALTER TABLE "person" ALTER COLUMN "external_sub" DROP NOT NULL;--> statement-breakpoint
UPDATE "person" SET "email" = lower("email");--> statement-breakpoint
ALTER TABLE "notification" ALTER COLUMN "person_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cohort" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "course" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "to_email" text;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "external_iss" text;--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_account_provider_idx" ON "auth_account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "auth_account_person_idx" ON "auth_account" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "auth_session_person_idx" ON "auth_session" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "invitation_person_idx" ON "invitation" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_external_identity_idx" ON "person" USING btree (coalesce("external_iss", ''),"external_sub") WHERE "person"."external_sub" is not null;--> statement-breakpoint
ALTER TABLE "cohort" ADD CONSTRAINT "cohort_external_ref_unique" UNIQUE("external_ref");--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_external_ref_unique" UNIQUE("external_ref");--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_email_unique" UNIQUE("email");--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_chk" CHECK ("notification"."person_id" is not null or "notification"."to_email" is not null);