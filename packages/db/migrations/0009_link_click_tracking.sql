CREATE TABLE "link_clicks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"link_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracked_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"message_id" uuid,
	"position" integer NOT NULL,
	"url" text NOT NULL,
	"contact_id" uuid,
	"automation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "link_clicks" ADD CONSTRAINT "link_clicks_link_id_tracked_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."tracked_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_links" ADD CONSTRAINT "tracked_links_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_links" ADD CONSTRAINT "tracked_links_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_links" ADD CONSTRAINT "tracked_links_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "link_clicks_link_idx" ON "link_clicks" USING btree ("link_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tracked_links_code_uq" ON "tracked_links" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "tracked_links_message_position_uq" ON "tracked_links" USING btree ("message_id","position");--> statement-breakpoint
CREATE INDEX "tracked_links_automation_idx" ON "tracked_links" USING btree ("automation_id","created_at");