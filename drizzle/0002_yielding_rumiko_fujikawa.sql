CREATE TABLE "subscription_deliveries" (
	"subscription_id" text NOT NULL,
	"job_id" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"message_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "subscription_deliveries_subscription_id_job_id_pk" PRIMARY KEY("subscription_id","job_id")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"programs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cycles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sponsorship" text DEFAULT 'any' NOT NULL,
	"require_link" boolean DEFAULT true NOT NULL,
	"remote_only" boolean DEFAULT false NOT NULL,
	"delivery_mode" text DEFAULT 'daily' NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"digest_hour" integer DEFAULT 9 NOT NULL,
	"next_digest_at" timestamp with time zone NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription_deliveries" ADD CONSTRAINT "subscription_deliveries_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_deliveries" ADD CONSTRAINT "subscription_deliveries_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_deliveries_pending_idx" ON "subscription_deliveries" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_guild_user_name_uidx" ON "subscriptions" USING btree ("guild_id","user_id","name_key");--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_digest_idx" ON "subscriptions" USING btree ("paused","delivery_mode","next_digest_at");