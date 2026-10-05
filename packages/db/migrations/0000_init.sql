CREATE TYPE "public"."account_status" AS ENUM('active', 'reauth_required', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."automation_status" AS ENUM('draft', 'active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('dm', 'private_reply', 'comment_reply', 'postback', 'story_reply');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sent', 'failed', 'received');--> statement-breakpoint
CREATE TYPE "public"."outbound_mode" AS ENUM('dm', 'private_reply', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'pro', 'business');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('instagram', 'facebook');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'waiting', 'completed', 'failed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "automation_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"automation_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"last_entered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"automation_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connected_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "automation_status" DEFAULT 'draft' NOT NULL,
	"trigger_type" text NOT NULL,
	"definition" jsonb NOT NULL,
	"current_version_id" uuid,
	"template_key" text,
	"pinned_media_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connected_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"external_id" text NOT NULL,
	"username" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"access_token_enc" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"connected_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connected_account_id" uuid NOT NULL,
	"platform_user_id" text NOT NULL,
	"username" text,
	"name" text,
	"avatar_url" text,
	"email" text,
	"phone" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"automation_id" uuid NOT NULL,
	"automation_version_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"connected_account_id" uuid NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"current_step_id" text,
	"wait" jsonb,
	"wait_until" timestamp with time zone,
	"vars" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"outbound" "outbound_mode" DEFAULT 'dm' NOT NULL,
	"comment_id" text,
	"trigger_ref" jsonb,
	"error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"contact_id" uuid NOT NULL,
	"connected_account_id" uuid NOT NULL,
	"flow_run_id" uuid,
	"direction" "message_direction" NOT NULL,
	"kind" "message_kind" NOT NULL,
	"body" jsonb NOT NULL,
	"external_id" text,
	"comment_id" text,
	"status" "message_status" NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"dodo_customer_id" text,
	"dodo_subscription_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"current_period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"period" text NOT NULL,
	"contacts_reached" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"platform" "platform" NOT NULL,
	"dedup_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_entries" ADD CONSTRAINT "automation_entries_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_entries" ADD CONSTRAINT "automation_entries_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_versions" ADD CONSTRAINT "automation_versions_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_current_version_id_automation_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."automation_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_automation_version_id_automation_versions_id_fk" FOREIGN KEY ("automation_version_id") REFERENCES "public"."automation_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_flow_run_id_flow_runs_id_fk" FOREIGN KEY ("flow_run_id") REFERENCES "public"."flow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_entries_automation_contact_uq" ON "automation_entries" USING btree ("automation_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_versions_automation_version_uq" ON "automation_versions" USING btree ("automation_id","version");--> statement-breakpoint
CREATE INDEX "automations_account_status_idx" ON "automations" USING btree ("connected_account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "connected_accounts_platform_external_uq" ON "connected_accounts" USING btree ("platform","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_account_platform_user_uq" ON "contacts" USING btree ("connected_account_id","platform_user_id");--> statement-breakpoint
CREATE INDEX "contacts_workspace_idx" ON "contacts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "contacts_tags_gin" ON "contacts" USING gin ("tags");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_runs_one_waiting_per_contact" ON "flow_runs" USING btree ("contact_id") WHERE "flow_runs"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX "flow_runs_status_wait_until_idx" ON "flow_runs" USING btree ("status","wait_until");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_one_private_reply_per_comment" ON "messages" USING btree ("comment_id") WHERE "messages"."kind" = 'private_reply';--> statement-breakpoint
CREATE UNIQUE INDEX "messages_one_comment_reply_per_comment" ON "messages" USING btree ("comment_id") WHERE "messages"."kind" = 'comment_reply';--> statement-breakpoint
CREATE INDEX "messages_contact_created_idx" ON "messages" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_status_created_idx" ON "messages" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_workspace_uq" ON "subscriptions" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_counters_workspace_period_uq" ON "usage_counters" USING btree ("workspace_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_dedup_key_uq" ON "webhook_events" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "webhook_events_received_at_idx" ON "webhook_events" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_workspace_user_uq" ON "workspace_members" USING btree ("workspace_id","user_id");