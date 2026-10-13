CREATE TYPE "public"."backfill_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "backfill_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"automation_id" uuid NOT NULL,
	"connected_account_id" uuid NOT NULL,
	"window_hours" integer NOT NULL,
	"status" "backfill_status" DEFAULT 'queued' NOT NULL,
	"found" integer DEFAULT 0 NOT NULL,
	"skipped_handled" integer DEFAULT 0 NOT NULL,
	"skipped_no_match" integer DEFAULT 0 NOT NULL,
	"enqueued" integer DEFAULT 0 NOT NULL,
	"capped" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "backfill_runs" ADD CONSTRAINT "backfill_runs_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backfill_runs" ADD CONSTRAINT "backfill_runs_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "backfill_runs_one_active_per_automation" ON "backfill_runs" USING btree ("automation_id") WHERE "backfill_runs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "backfill_runs_automation_created_idx" ON "backfill_runs" USING btree ("automation_id","created_at");