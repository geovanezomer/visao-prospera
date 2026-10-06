CREATE TABLE "odoo_snapshot_companies" (
	"snapshot_id" uuid NOT NULL,
	"company_id" integer NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "odoo_snapshot_companies_snapshot_id_company_id_pk" PRIMARY KEY("snapshot_id","company_id")
);
--> statement-breakpoint
ALTER TABLE "odoo_snapshot_companies" ADD CONSTRAINT "odoo_snapshot_companies_snapshot_id_odoo_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."odoo_snapshots"("id") ON DELETE cascade ON UPDATE no action;