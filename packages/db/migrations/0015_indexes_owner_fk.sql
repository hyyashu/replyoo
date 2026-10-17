-- Guards: fail loudly instead of deleting data. Fix the reported rows by hand, then rerun the migration.
DO $$
DECLARE orphans bigint;
BEGIN
	SELECT count(*) INTO orphans FROM "workspaces" w WHERE NOT EXISTS (SELECT 1 FROM "user" u WHERE u."id" = w."owner_user_id");
	IF orphans > 0 THEN
		RAISE EXCEPTION 'migration 0015: % workspace(s) have an owner_user_id with no matching "user" row; reassign or delete them first (SELECT id, owner_user_id FROM workspaces w WHERE NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = w.owner_user_id))', orphans;
	END IF;
END $$;--> statement-breakpoint
DO $$
DECLARE dupes bigint;
BEGIN
	SELECT count(*) INTO dupes FROM (
		SELECT "dodo_subscription_id" FROM "subscriptions" WHERE "dodo_subscription_id" IS NOT NULL GROUP BY 1 HAVING count(*) > 1
	) d;
	IF dupes > 0 THEN
		RAISE EXCEPTION 'migration 0015: % dodo_subscription_id value(s) are shared by several subscriptions rows; resolve them first (SELECT dodo_subscription_id, array_agg(workspace_id) FROM subscriptions WHERE dodo_subscription_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1)', dupes;
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
DROP INDEX "subscriptions_dodo_subscription_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_dodo_subscription_uq" ON "subscriptions" USING btree ("dodo_subscription_id") WHERE "subscriptions"."dodo_subscription_id" is not null;--> statement-breakpoint
CREATE INDEX "click_follow_ups_flow_run_idx" ON "click_follow_ups" USING btree ("flow_run_id");--> statement-breakpoint
CREATE INDEX "click_follow_ups_automation_idx" ON "click_follow_ups" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "flow_runs_contact_idx" ON "flow_runs" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "flow_runs_account_comment_idx" ON "flow_runs" USING btree ("connected_account_id","comment_id");--> statement-breakpoint
CREATE INDEX "messages_account_comment_idx" ON "messages" USING btree ("connected_account_id","comment_id");--> statement-breakpoint
CREATE INDEX "messages_flow_run_idx" ON "messages" USING btree ("flow_run_id");
