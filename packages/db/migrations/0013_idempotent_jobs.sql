ALTER TYPE "public"."message_status" ADD VALUE 'sending' BEFORE 'sent';--> statement-breakpoint
CREATE TABLE "job_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"queue" text NOT NULL,
	"job_id" text NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enqueued_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "job_outbox_job_id_uq" ON "job_outbox" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_outbox_pending_idx" ON "job_outbox" USING btree ("created_at") WHERE "job_outbox"."enqueued_at" is null;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;