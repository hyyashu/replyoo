ALTER TYPE "public"."message_kind" ADD VALUE 'comment';--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "last_counted_period" text;