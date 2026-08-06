CREATE TABLE "notification_role_memberships" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"program" text NOT NULL,
	"cycle" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_role_memberships_guild_id_user_id_program_cycle_pk" PRIMARY KEY("guild_id","user_id","program","cycle")
);
--> statement-breakpoint
CREATE TABLE "notification_roles" (
	"guild_id" text NOT NULL,
	"program" text NOT NULL,
	"cycle" text NOT NULL,
	"role_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_roles_guild_id_program_cycle_pk" PRIMARY KEY("guild_id","program","cycle")
);
--> statement-breakpoint
CREATE INDEX "notification_role_memberships_category_idx" ON "notification_role_memberships" USING btree ("guild_id","program","cycle");--> statement-breakpoint
CREATE INDEX "notification_role_memberships_user_idx" ON "notification_role_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_roles_guild_role_uidx" ON "notification_roles" USING btree ("guild_id","role_id");