CREATE TYPE "public"."billing_interval" AS ENUM('month', 'year');--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "billing_interval" "billing_interval" DEFAULT 'month' NOT NULL;