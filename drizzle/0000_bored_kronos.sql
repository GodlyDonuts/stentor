CREATE TABLE "announcements" (
	"guild_id" text NOT NULL,
	"job_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "announcements_guild_id_job_id_pk" PRIMARY KEY("guild_id","job_id")
);
--> statement-breakpoint
CREATE TABLE "guild_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"ping_role_id" text,
	"programs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cycles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"require_link" boolean DEFAULT false NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"configured_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"owner_guild_id" text,
	"posted_by" text,
	"company" text NOT NULL,
	"title" text NOT NULL,
	"location" text NOT NULL,
	"description" text,
	"url" text,
	"url_host" text,
	"link_status" text NOT NULL,
	"program" text NOT NULL,
	"cycle" text NOT NULL,
	"sponsorship" text,
	"status" text NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"source" text PRIMARY KEY NOT NULL,
	"etag" text,
	"baseline_complete" boolean DEFAULT false NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"jobs_seen" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_pending_idx" ON "announcements" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "jobs_status_first_seen_idx" ON "jobs" USING btree ("status","first_seen");--> statement-breakpoint
CREATE INDEX "jobs_owner_guild_idx" ON "jobs" USING btree ("owner_guild_id");--> statement-breakpoint
CREATE INDEX "jobs_program_cycle_idx" ON "jobs" USING btree ("program","cycle");