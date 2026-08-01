ALTER TABLE "guild_settings" ADD COLUMN "sponsorship" text DEFAULT 'any' NOT NULL;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "remote_only" boolean DEFAULT false NOT NULL;