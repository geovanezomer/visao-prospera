CREATE TABLE "odoo_account_overrides" (
	"code" text PRIMARY KEY NOT NULL,
	"target" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "odoo_connection" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"data_source" text DEFAULT 'manual' NOT NULL,
	"url" text,
	"database" text,
	"api_key_enc" text,
	"company_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"history_months" integer DEFAULT 24 NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" text,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "odoo_connection_singleton" CHECK ("odoo_connection"."id" = 1),
	CONSTRAINT "odoo_connection_source_check" CHECK ("odoo_connection"."data_source" in ('manual','odoo'))
);
--> statement-breakpoint
CREATE TABLE "odoo_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"duration_ms" integer,
	"payload" jsonb,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "odoo_account_overrides" ADD CONSTRAINT "odoo_account_overrides_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odoo_connection" ADD CONSTRAINT "odoo_connection_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "odoo_snapshots_synced_idx" ON "odoo_snapshots" USING btree ("synced_at" DESC NULLS LAST);