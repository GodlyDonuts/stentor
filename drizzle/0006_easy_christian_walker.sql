ALTER TABLE "guild_settings" ADD COLUMN "delivery_mode" text DEFAULT 'announcements' NOT NULL;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "board_message_id" text;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "board_updated_at" timestamp with time zone;