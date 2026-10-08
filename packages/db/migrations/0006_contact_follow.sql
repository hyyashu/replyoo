ALTER TABLE "contacts" ADD COLUMN "follows_you" boolean;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "you_follow" boolean;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "follow_checked_at" timestamp with time zone;