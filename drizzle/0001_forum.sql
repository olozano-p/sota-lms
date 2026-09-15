CREATE TABLE "forum_post" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"author_person_id" uuid,
	"body_md" text NOT NULL,
	"reply_to_post_id" uuid,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forum_reaction" (
	"post_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_reaction_post_id_person_id_pk" PRIMARY KEY("post_id","person_id"),
	CONSTRAINT "forum_reaction_value" CHECK ("forum_reaction"."value" in ('like', 'dislike'))
);
--> statement-breakpoint
CREATE TABLE "forum_thread" (
	"id" uuid PRIMARY KEY NOT NULL,
	"course_id" uuid,
	"author_person_id" uuid,
	"title" text NOT NULL,
	"pinned_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course" ADD COLUMN "forum_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "forum_post" ADD CONSTRAINT "forum_post_thread_id_forum_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."forum_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_post" ADD CONSTRAINT "forum_post_author_person_id_person_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_reaction" ADD CONSTRAINT "forum_reaction_post_id_forum_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."forum_post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_reaction" ADD CONSTRAINT "forum_reaction_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_thread" ADD CONSTRAINT "forum_thread_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_thread" ADD CONSTRAINT "forum_thread_author_person_id_person_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "forum_post_thread_created_idx" ON "forum_post" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "forum_thread_course_created_idx" ON "forum_thread" USING btree ("course_id","created_at");--> statement-breakpoint
CREATE INDEX "forum_thread_course_pinned_idx" ON "forum_thread" USING btree ("course_id","pinned_at");