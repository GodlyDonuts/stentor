import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export interface JobMatchSnapshot {
  status: string;
  company: string;
  title: string;
  location: string;
  program: string;
  cycle: string;
  url: string | null;
  sponsorship: string | null;
}

export const guildSettings = pgTable("guild_settings", {
  guildId: text("guild_id").primaryKey(),
  channelId: text("channel_id").notNull(),
  pingRoleId: text("ping_role_id"),
  deliveryMode: text("delivery_mode").notNull().default("announcements"),
  boardMessageId: text("board_message_id"),
  boardUpdatedAt: timestamp("board_updated_at", { withTimezone: true }),
  programs: jsonb("programs").$type<string[]>().notNull().default([]),
  cycles: jsonb("cycles").$type<string[]>().notNull().default([]),
  keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
  locations: jsonb("locations").$type<string[]>().notNull().default([]),
  sponsorship: text("sponsorship").notNull().default("any"),
  requireLink: boolean("require_link").notNull().default(false),
  remoteOnly: boolean("remote_only").notNull().default(false),
  paused: boolean("paused").notNull().default(false),
  configuredBy: text("configured_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    ownerGuildId: text("owner_guild_id"),
    postedBy: text("posted_by"),
    company: text("company").notNull(),
    title: text("title").notNull(),
    location: text("location").notNull(),
    description: text("description"),
    url: text("url"),
    urlHost: text("url_host"),
    linkStatus: text("link_status").notNull(),
    program: text("program").notNull(),
    cycle: text("cycle").notNull(),
    sponsorship: text("sponsorship"),
    status: text("status").notNull(),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("jobs_status_first_seen_idx").on(table.status, table.firstSeen),
    index("jobs_owner_guild_idx").on(table.ownerGuildId),
    index("jobs_program_cycle_idx").on(table.program, table.cycle),
  ],
);

export const jobFanoutEvents = pgTable("job_fanout_events", {
  jobId: text("job_id")
    .primaryKey()
    .references(() => jobs.id, { onDelete: "cascade" }),
  before: jsonb("before").$type<JobMatchSnapshot | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const announcements = pgTable(
  "announcements",
  {
    guildId: text("guild_id").notNull(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull(),
    messageId: text("message_id"),
    action: text("action").notNull().default("post"),
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.jobId] }),
    index("announcements_pending_idx").on(table.state, table.nextAttemptAt),
  ],
);

export const syncState = pgTable("sync_state", {
  source: text("source").primaryKey(),
  etag: text("etag"),
  baselineComplete: boolean("baseline_complete").notNull().default(false),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastError: text("last_error"),
  jobsSeen: bigint("jobs_seen", { mode: "number" }).notNull().default(0),
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    programs: jsonb("programs").$type<string[]>().notNull().default([]),
    cycles: jsonb("cycles").$type<string[]>().notNull().default([]),
    keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
    locations: jsonb("locations").$type<string[]>().notNull().default([]),
    sponsorship: text("sponsorship").notNull().default("any"),
    requireLink: boolean("require_link").notNull().default(true),
    remoteOnly: boolean("remote_only").notNull().default(false),
    deliveryMode: text("delivery_mode").notNull().default("daily"),
    timezone: text("timezone").notNull().default("America/New_York"),
    digestHour: integer("digest_hour").notNull().default(9),
    nextDigestAt: timestamp("next_digest_at", { withTimezone: true }).notNull(),
    paused: boolean("paused").notNull().default(false),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("subscriptions_guild_user_name_uidx").on(
      table.guildId,
      table.userId,
      table.nameKey,
    ),
    index("subscriptions_user_idx").on(table.guildId, table.userId),
    index("subscriptions_digest_idx").on(table.paused, table.deliveryMode, table.nextDigestAt),
  ],
);

export const notificationRoles = pgTable(
  "notification_roles",
  {
    guildId: text("guild_id").notNull(),
    program: text("program").notNull(),
    cycle: text("cycle").notNull(),
    roleId: text("role_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.program, table.cycle] }),
    uniqueIndex("notification_roles_guild_role_uidx").on(table.guildId, table.roleId),
  ],
);

export const notificationRoleMemberships = pgTable(
  "notification_role_memberships",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    program: text("program").notNull(),
    cycle: text("cycle").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.userId, table.program, table.cycle] }),
    index("notification_role_memberships_category_idx").on(
      table.guildId,
      table.program,
      table.cycle,
    ),
    index("notification_role_memberships_user_idx").on(table.userId),
  ],
);

export const subscriptionDeliveries = pgTable(
  "subscription_deliveries",
  {
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    messageId: text("message_id"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.subscriptionId, table.jobId] }),
    index("subscription_deliveries_pending_idx").on(table.state, table.nextAttemptAt),
    index("subscription_deliveries_history_idx").on(table.state, table.createdAt),
  ],
);

export type GuildSettings = typeof guildSettings.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Announcement = typeof announcements.$inferSelect;
export type SyncState = typeof syncState.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type SubscriptionDelivery = typeof subscriptionDeliveries.$inferSelect;
export type NotificationRole = typeof notificationRoles.$inferSelect;
export type NotificationRoleMembership = typeof notificationRoleMemberships.$inferSelect;
