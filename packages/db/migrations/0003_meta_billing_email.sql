CREATE TABLE "data_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"confirmation_code" text NOT NULL,
	"platform" "platform" NOT NULL,
	"meta_user_id" text NOT NULL,
	"accounts_deleted" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD COLUMN "meta_user_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "dodo_event_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "data_deletion_requests_code_uq" ON "data_deletion_requests" USING btree ("confirmation_code");--> statement-breakpoint
CREATE INDEX "connected_accounts_meta_user_idx" ON "connected_accounts" USING btree ("platform","meta_user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_dodo_subscription_idx" ON "subscriptions" USING btree ("dodo_subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_dodo_customer_idx" ON "subscriptions" USING btree ("dodo_customer_id");