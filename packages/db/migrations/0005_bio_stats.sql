CREATE TABLE "bio_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"page_id" uuid NOT NULL,
	"block_id" uuid,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bio_events" ADD CONSTRAINT "bio_events_page_id_bio_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."bio_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bio_events" ADD CONSTRAINT "bio_events_block_id_bio_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."bio_blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bio_events_page_type_idx" ON "bio_events" USING btree ("page_id","type","created_at");--> statement-breakpoint
CREATE INDEX "bio_events_block_idx" ON "bio_events" USING btree ("block_id","created_at");