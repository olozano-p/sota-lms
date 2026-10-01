ALTER TABLE "quiz" ALTER COLUMN "kind" SET DEFAULT 'self_check';--> statement-breakpoint
UPDATE "quiz" SET "kind" = 'self_check' WHERE "kind" = 'quiz';
