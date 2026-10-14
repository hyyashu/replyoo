CREATE TYPE "public"."click_follow_up_status" AS ENUM('pending', 'sent', 'skipped');--> statement-breakpoint
CREATE TABLE "click_follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"message_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"connected_account_id" uuid NOT NULL,
	"automation_id" uuid,
	"flow_run_id" uuid,
	"text" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" "click_follow_up_status" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"follow_up_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "click_follow_ups" ADD CONSTRAINT "click_follow_ups_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_follow_ups" ADD CONSTRAINT "click_follow_ups_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_follow_ups" ADD CONSTRAINT "click_follow_ups_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_follow_ups" ADD CONSTRAINT "click_follow_ups_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_follow_ups" ADD CONSTRAINT "click_follow_ups_flow_run_id_flow_runs_id_fk" FOREIGN KEY ("flow_run_id") REFERENCES "public"."flow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_follow_ups" ADD CONSTRAINT "click_follow_ups_follow_up_message_id_messages_id_fk" FOREIGN KEY ("follow_up_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "click_follow_ups_message_uq" ON "click_follow_ups" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "click_follow_ups_due_idx" ON "click_follow_ups" USING btree ("status","due_at");