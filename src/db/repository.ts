import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import type { KeryxJob } from "../domain/keryx.js";
import { dateAtUtcMidnight } from "../domain/keryx.js";
import { jobMatchInputsChanged } from "../domain/filter.js";
import type { JobSearchFilters } from "../domain/search.js";
import type { Database } from "./client.js";
import {
  announcements,
  guildSettings,
  jobFanoutEvents,
  jobs,
  subscriptionDeliveries,
  subscriptions,
  syncState,
  type GuildSettings,
  type Job,
  type JobMatchSnapshot,
  type NewJob,
  type Subscription,
} from "./schema.js";

const KERYX_SOURCE = "keryx";

function jobMatchSnapshot(job: Job): JobMatchSnapshot {
  return {
    status: job.status,
    company: job.company,
    title: job.title,
    location: job.location,
    program: job.program,
    cycle: job.cycle,
    url: job.url,
    sponsorship: job.sponsorship,
  };
}

export interface GuildConfiguration {
  guildId: string;
  channelId: string;
  pingRoleId?: string | null;
  programs: string[];
  cycles: string[];
  keywords: string[];
  locations: string[];
  sponsorship: string;
  requireLink: boolean;
  remoteOnly: boolean;
  configuredBy: string;
}

export interface AdminJobInput {
  guildId: string;
  postedBy: string;
  company: string;
  title: string;
  location: string;
  description?: string | null | undefined;
  url: string;
  urlHost: string;
  program: "internship" | "new-grad" | "experienced";
  cycle?: string | undefined;
  closesAt?: Date | null | undefined;
}

export interface SubscriptionInput {
  guildId: string;
  userId: string;
  name: string;
  programs: string[];
  cycles: string[];
  keywords: string[];
  locations: string[];
  sponsorship: string;
  requireLink: boolean;
  remoteOnly: boolean;
  deliveryMode: "immediate" | "daily";
  timezone: string;
  digestHour: number;
  nextDigestAt: Date;
}

export interface KeryxJobChange {
  before: Job | null;
  after: Job;
}

export class Repository {
  public constructor(private readonly db: Database) {}

  async ping(): Promise<void> {
    await this.db.execute(sql`select 1`);
  }

  async getGuildSettings(guildId: string): Promise<GuildSettings | null> {
    const [result] = await this.db
      .select()
      .from(guildSettings)
      .where(eq(guildSettings.guildId, guildId))
      .limit(1);
    return result ?? null;
  }

  async listActiveGuilds(): Promise<GuildSettings[]> {
    return this.db.select().from(guildSettings).where(eq(guildSettings.paused, false));
  }

  async configureGuild(configuration: GuildConfiguration): Promise<GuildSettings> {
    const [result] = await this.db
      .insert(guildSettings)
      .values(configuration)
      .onConflictDoUpdate({
        target: guildSettings.guildId,
        set: {
          channelId: configuration.channelId,
          pingRoleId: configuration.pingRoleId,
          programs: configuration.programs,
          cycles: configuration.cycles,
          keywords: configuration.keywords,
          locations: configuration.locations,
          sponsorship: configuration.sponsorship,
          requireLink: configuration.requireLink,
          remoteOnly: configuration.remoteOnly,
          configuredBy: configuration.configuredBy,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!result) throw new Error("Guild configuration was not saved");
    return result;
  }

  async setGuildPaused(guildId: string, paused: boolean): Promise<boolean> {
    const rows = await this.db
      .update(guildSettings)
      .set({ paused, updatedAt: new Date() })
      .where(eq(guildSettings.guildId, guildId))
      .returning({ guildId: guildSettings.guildId });
    return rows.length > 0;
  }

  async getSyncState() {
    const [state] = await this.db
      .select()
      .from(syncState)
      .where(eq(syncState.source, KERYX_SOURCE))
      .limit(1);
    return state ?? null;
  }

  async markSyncChecked(etag?: string | null): Promise<void> {
    await this.db
      .insert(syncState)
      .values({ source: KERYX_SOURCE, etag: etag ?? null, lastCheckedAt: new Date() })
      .onConflictDoUpdate({
        target: syncState.source,
        set: { etag: etag ?? null, lastCheckedAt: new Date() },
      });
  }

  async markSyncFailed(error: string): Promise<void> {
    await this.db
      .insert(syncState)
      .values({
        source: KERYX_SOURCE,
        lastCheckedAt: new Date(),
        lastError: error.slice(0, 2_000),
        consecutiveFailures: 1,
      })
      .onConflictDoUpdate({
        target: syncState.source,
        set: {
          lastCheckedAt: new Date(),
          lastError: error.slice(0, 2_000),
          consecutiveFailures: sql`${syncState.consecutiveFailures} + 1`,
        },
      });
  }

  async upsertKeryxJobs(
    input: KeryxJob[],
    etag: string | null,
  ): Promise<{ jobs: Job[]; updated: KeryxJobChange[]; closed: Job[]; baseline: boolean }> {
    return this.db.transaction(async (tx) => {
      const [state] = await tx
        .select()
        .from(syncState)
        .where(eq(syncState.source, KERYX_SOURCE))
        .limit(1);
      const baseline = !(state?.baselineComplete ?? false);
      const ids = input.map((job) => job.id);
      const known = new Map<string, Job>();
      for (let offset = 0; offset < ids.length; offset += 5_000) {
        const chunk = ids.slice(offset, offset + 5_000);
        if (chunk.length === 0) continue;
        const found = await tx.select().from(jobs).where(inArray(jobs.id, chunk));
        found.forEach((row) => known.set(row.id, row));
      }

      const inserted: Job[] = [];
      const updated: Array<{ before: Job; after: Job }> = [];
      for (let offset = 0; offset < input.length; offset += 500) {
        const chunk = input.slice(offset, offset + 500);
        const values: NewJob[] = chunk.map((job) => ({
          id: job.id,
          source: KERYX_SOURCE,
          company: job.company,
          title: job.title,
          location: job.location,
          url: job.url,
          urlHost: job.url_host,
          linkStatus: job.link_status,
          program: job.program,
          cycle: job.cycle,
          sponsorship: job.sponsorship,
          status: job.status,
          firstSeen: dateAtUtcMidnight(job.first_seen) ?? new Date(),
          postedAt: dateAtUtcMidnight(job.posted_at),
          closedAt: dateAtUtcMidnight(job.closed_at),
          raw: job,
          updatedAt: new Date(),
        }));
        if (values.length === 0) continue;
        const returned = await tx
          .insert(jobs)
          .values(values)
          .onConflictDoUpdate({
            target: jobs.id,
            set: {
              company: sql`excluded.company`,
              title: sql`excluded.title`,
              location: sql`excluded.location`,
              url: sql`excluded.url`,
              urlHost: sql`excluded.url_host`,
              linkStatus: sql`excluded.link_status`,
              program: sql`excluded.program`,
              cycle: sql`excluded.cycle`,
              sponsorship: sql`excluded.sponsorship`,
              status: sql`excluded.status`,
              postedAt: sql`excluded.posted_at`,
              closedAt: sql`excluded.closed_at`,
              raw: sql`excluded.raw`,
              updatedAt: new Date(),
            },
          })
          .returning();
        for (const job of returned) {
          const before = known.get(job.id);
          if (!before) inserted.push(job);
          else if (jobMatchInputsChanged(before, job)) updated.push({ before, after: job });
        }
      }

      if (!baseline) {
        const events = [
          ...inserted.map((job) => ({ jobId: job.id, before: null })),
          ...updated.map((change) => ({
            jobId: change.after.id,
            before: jobMatchSnapshot(change.before),
          })),
        ];
        if (events.length > 0) {
          await tx.insert(jobFanoutEvents).values(events).onConflictDoNothing();
        }
      }

      await tx
        .insert(syncState)
        .values({
          source: KERYX_SOURCE,
          etag,
          baselineComplete: true,
          consecutiveFailures: 0,
          lastCheckedAt: new Date(),
          lastSuccessAt: new Date(),
          lastError: null,
          jobsSeen: input.length,
        })
        .onConflictDoUpdate({
          target: syncState.source,
          set: {
            etag,
            baselineComplete: true,
            consecutiveFailures: 0,
            lastCheckedAt: new Date(),
            lastSuccessAt: new Date(),
            lastError: null,
            jobsSeen: input.length,
          },
        });
      const closedIds = input
        .filter((job) => job.status === "closed" && known.get(job.id)?.status === "open")
        .map((job) => job.id);
      const closed =
        closedIds.length > 0 ? await tx.select().from(jobs).where(inArray(jobs.id, closedIds)) : [];
      return { jobs: inserted, updated, closed, baseline };
    });
  }

  async listPendingKeryxJobChanges(limit = 5_000): Promise<KeryxJobChange[]> {
    const rows = await this.db
      .select({ event: jobFanoutEvents, job: jobs })
      .from(jobFanoutEvents)
      .innerJoin(jobs, eq(jobs.id, jobFanoutEvents.jobId))
      .orderBy(asc(jobFanoutEvents.createdAt))
      .limit(limit);
    return rows.map(({ event, job }) => ({
      before: event.before ? { ...job, ...event.before } : null,
      after: job,
    }));
  }

  async deleteKeryxJobChanges(jobIds: string[]): Promise<void> {
    if (jobIds.length === 0) return;
    await this.db.delete(jobFanoutEvents).where(inArray(jobFanoutEvents.jobId, jobIds));
  }

  async createAdminJob(input: AdminJobInput): Promise<Job> {
    const now = new Date();
    const [job] = await this.db
      .insert(jobs)
      .values({
        id: `admin_${randomUUID()}`,
        source: "admin",
        ownerGuildId: input.guildId,
        postedBy: input.postedBy,
        company: input.company,
        title: input.title,
        location: input.location,
        description: input.description,
        url: input.url,
        urlHost: input.urlHost,
        linkStatus: "admin-submitted",
        program: input.program,
        cycle: input.cycle ?? "unscheduled",
        status: "open",
        firstSeen: now,
        postedAt: now,
        closesAt: input.closesAt,
      })
      .returning();
    if (!job) throw new Error("Admin job was not created");
    return job;
  }

  async closeAdminJob(guildId: string, jobId: string): Promise<Job | null> {
    const [job] = await this.db
      .update(jobs)
      .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.source, "admin"), eq(jobs.ownerGuildId, guildId)))
      .returning();
    return job ?? null;
  }

  async closeExpiredAdminJobs(): Promise<Job[]> {
    const result = await this.db
      .update(jobs)
      .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(jobs.source, "admin"), eq(jobs.status, "open"), lte(jobs.closesAt, new Date())))
      .returning({ id: jobs.id });
    if (result.length === 0) return [];
    return this.db
      .select()
      .from(jobs)
      .where(
        inArray(
          jobs.id,
          result.map((row) => row.id),
        ),
      );
  }

  async enqueueAnnouncement(guildId: string, channelId: string, jobId: string): Promise<void> {
    await this.db.insert(announcements).values({ guildId, channelId, jobId }).onConflictDoNothing();
  }

  async enqueueClosureUpdates(jobIds: string[]): Promise<void> {
    if (jobIds.length === 0) return;
    await this.db
      .update(announcements)
      .set({ action: "close", state: "dead", lastError: "Listing closed before delivery" })
      .where(
        and(
          inArray(announcements.jobId, jobIds),
          or(eq(announcements.state, "pending"), eq(announcements.state, "failed")),
        ),
      );
    await this.db
      .update(announcements)
      .set({ action: "close", state: "pending", attempts: 0, nextAttemptAt: new Date() })
      .where(and(inArray(announcements.jobId, jobIds), eq(announcements.state, "sent")));
  }

  async listPendingAnnouncements(limit = 10) {
    return this.db
      .select({ announcement: announcements, job: jobs, settings: guildSettings })
      .from(announcements)
      .innerJoin(jobs, eq(jobs.id, announcements.jobId))
      .innerJoin(guildSettings, eq(guildSettings.guildId, announcements.guildId))
      .where(
        and(
          or(eq(announcements.state, "pending"), eq(announcements.state, "failed")),
          lte(announcements.nextAttemptAt, new Date()),
          eq(guildSettings.paused, false),
        ),
      )
      .orderBy(asc(announcements.createdAt))
      .limit(limit);
  }

  async markAnnouncementSent(guildId: string, jobId: string, messageId: string): Promise<void> {
    await this.db
      .update(announcements)
      .set({ state: "sent", messageId, sentAt: new Date(), lastError: null })
      .where(and(eq(announcements.guildId, guildId), eq(announcements.jobId, jobId)));
  }

  async markAnnouncementFailed(
    guildId: string,
    jobId: string,
    attempts: number,
    error: string,
  ): Promise<void> {
    const cappedAttempts = attempts + 1;
    const backoffMinutes = Math.min(60, 2 ** Math.min(cappedAttempts, 6));
    await this.db
      .update(announcements)
      .set({
        state: cappedAttempts >= 10 ? "dead" : "failed",
        attempts: cappedAttempts,
        lastError: error.slice(0, 2_000),
        nextAttemptAt: new Date(Date.now() + backoffMinutes * 60_000),
      })
      .where(and(eq(announcements.guildId, guildId), eq(announcements.jobId, jobId)));
  }

  async searchJobs(
    guildId: string,
    filters: JobSearchFilters,
    offset: number,
    limit: number,
  ): Promise<Job[]> {
    const text = filters.query.trim();
    const conditions = [
      eq(jobs.status, "open"),
      or(eq(jobs.source, KERYX_SOURCE), eq(jobs.ownerGuildId, guildId))!,
    ];
    if (text) {
      const pattern = `%${text.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      conditions.push(
        or(
          ilike(jobs.company, pattern),
          ilike(jobs.title, pattern),
          ilike(jobs.location, pattern),
        )!,
      );
    }
    if (filters.program) conditions.push(eq(jobs.program, filters.program));
    if (filters.cycle) conditions.push(eq(jobs.cycle, filters.cycle.toLocaleLowerCase("en-US")));
    if (filters.location) conditions.push(ilike(jobs.location, `%${filters.location}%`));
    if (filters.remoteOnly) conditions.push(ilike(jobs.location, "%remote%"));
    if (filters.requireLink) conditions.push(isNotNull(jobs.url));
    if (filters.sponsorship === "offers") {
      conditions.push(
        or(eq(jobs.sponsorship, "Offers Sponsorship"), eq(jobs.sponsorship, "offers"))!,
      );
    }
    if (filters.sponsorship === "no-sponsorship") {
      conditions.push(
        or(
          ilike(jobs.sponsorship, "%no-sponsorship%"),
          ilike(jobs.sponsorship, "%does not offer%"),
          ilike(jobs.sponsorship, "%citizen%"),
        )!,
      );
    }
    return this.db
      .select()
      .from(jobs)
      .where(and(...conditions))
      .orderBy(desc(jobs.firstSeen), desc(jobs.createdAt))
      .offset(Math.max(0, offset))
      .limit(Math.min(6, limit));
  }

  async getJob(id: string): Promise<Job | null> {
    const [job] = await this.db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
    return job ?? null;
  }

  async getAnnouncement(guildId: string, jobId: string) {
    const [announcement] = await this.db
      .select()
      .from(announcements)
      .where(and(eq(announcements.guildId, guildId), eq(announcements.jobId, jobId)))
      .limit(1);
    return announcement ?? null;
  }

  async saveSubscription(input: SubscriptionInput): Promise<Subscription> {
    const nameKey = input.name.trim().toLocaleLowerCase("en-US");
    const values = { id: randomUUID(), ...input, nameKey };
    const [subscription] = await this.db
      .insert(subscriptions)
      .values(values)
      .onConflictDoUpdate({
        target: [subscriptions.guildId, subscriptions.userId, subscriptions.nameKey],
        set: {
          name: input.name,
          programs: input.programs,
          cycles: input.cycles,
          keywords: input.keywords,
          locations: input.locations,
          sponsorship: input.sponsorship,
          requireLink: input.requireLink,
          remoteOnly: input.remoteOnly,
          deliveryMode: input.deliveryMode,
          timezone: input.timezone,
          digestHour: input.digestHour,
          nextDigestAt: input.nextDigestAt,
          paused: false,
          lastError: null,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!subscription) throw new Error("Subscription was not saved");
    return subscription;
  }

  async discardPendingSubscriptionDeliveries(subscriptionId: string): Promise<void> {
    await this.db
      .delete(subscriptionDeliveries)
      .where(
        and(
          eq(subscriptionDeliveries.subscriptionId, subscriptionId),
          or(
            eq(subscriptionDeliveries.state, "pending"),
            eq(subscriptionDeliveries.state, "failed"),
          ),
        ),
      );
  }

  async listUserSubscriptions(guildId: string, userId: string): Promise<Subscription[]> {
    return this.db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.guildId, guildId), eq(subscriptions.userId, userId)))
      .orderBy(asc(subscriptions.name));
  }

  async getUserSubscription(
    guildId: string,
    userId: string,
    name: string,
  ): Promise<Subscription | null> {
    const [subscription] = await this.db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.guildId, guildId),
          eq(subscriptions.userId, userId),
          eq(subscriptions.nameKey, name.trim().toLocaleLowerCase("en-US")),
        ),
      )
      .limit(1);
    return subscription ?? null;
  }

  async searchSubscriptionMatches(subscription: Subscription, limit = 5): Promise<Job[]> {
    const conditions = [
      eq(jobs.status, "open"),
      or(eq(jobs.source, KERYX_SOURCE), eq(jobs.ownerGuildId, subscription.guildId))!,
    ];
    if (subscription.programs.length > 0) {
      conditions.push(inArray(jobs.program, subscription.programs));
    }
    if (subscription.cycles.length > 0) {
      conditions.push(inArray(jobs.cycle, subscription.cycles));
    }
    if (subscription.requireLink) conditions.push(isNotNull(jobs.url));
    if (subscription.remoteOnly) conditions.push(ilike(jobs.location, "%remote%"));
    if (subscription.keywords.length > 0) {
      conditions.push(
        or(
          ...subscription.keywords.flatMap((keyword) => [
            ilike(jobs.company, `%${keyword}%`),
            ilike(jobs.title, `%${keyword}%`),
          ]),
        )!,
      );
    }
    if (subscription.locations.length > 0) {
      conditions.push(
        or(...subscription.locations.map((location) => ilike(jobs.location, `%${location}%`)))!,
      );
    }
    if (subscription.sponsorship === "offers") {
      conditions.push(
        or(eq(jobs.sponsorship, "Offers Sponsorship"), eq(jobs.sponsorship, "offers"))!,
      );
    }
    if (subscription.sponsorship === "no-sponsorship") {
      conditions.push(
        or(
          ilike(jobs.sponsorship, "%no-sponsorship%"),
          ilike(jobs.sponsorship, "%does not offer%"),
          ilike(jobs.sponsorship, "%citizen%"),
        )!,
      );
    }
    return this.db
      .select()
      .from(jobs)
      .where(and(...conditions))
      .orderBy(desc(jobs.firstSeen), desc(jobs.createdAt))
      .limit(Math.min(10, limit));
  }

  async setSubscriptionPaused(
    guildId: string,
    userId: string,
    name: string,
    paused: boolean,
  ): Promise<Subscription | null> {
    const [subscription] = await this.db
      .update(subscriptions)
      .set({ paused, lastError: null, updatedAt: new Date() })
      .where(
        and(
          eq(subscriptions.guildId, guildId),
          eq(subscriptions.userId, userId),
          eq(subscriptions.nameKey, name.trim().toLocaleLowerCase("en-US")),
        ),
      )
      .returning();
    return subscription ?? null;
  }

  async deleteSubscription(guildId: string, userId: string, name: string): Promise<boolean> {
    const deleted = await this.db
      .delete(subscriptions)
      .where(
        and(
          eq(subscriptions.guildId, guildId),
          eq(subscriptions.userId, userId),
          eq(subscriptions.nameKey, name.trim().toLocaleLowerCase("en-US")),
        ),
      )
      .returning({ id: subscriptions.id });
    return deleted.length > 0;
  }

  async deleteUserSubscriptions(userId: string): Promise<number> {
    const deleted = await this.db
      .delete(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .returning({ id: subscriptions.id });
    return deleted.length;
  }

  async listActiveSubscriptions(): Promise<Subscription[]> {
    return this.db.select().from(subscriptions).where(eq(subscriptions.paused, false));
  }

  async enqueueSubscriptionDeliveries(
    values: Array<{ subscriptionId: string; jobId: string }>,
  ): Promise<number> {
    if (values.length === 0) return 0;
    let inserted = 0;
    for (let offset = 0; offset < values.length; offset += 1_000) {
      const rows = await this.db
        .insert(subscriptionDeliveries)
        .values(values.slice(offset, offset + 1_000))
        .onConflictDoNothing()
        .returning({ jobId: subscriptionDeliveries.jobId });
      inserted += rows.length;
    }
    return inserted;
  }

  async listPendingImmediateDeliveries(limit = 10) {
    return this.db
      .select({ delivery: subscriptionDeliveries, subscription: subscriptions, job: jobs })
      .from(subscriptionDeliveries)
      .innerJoin(subscriptions, eq(subscriptions.id, subscriptionDeliveries.subscriptionId))
      .innerJoin(jobs, eq(jobs.id, subscriptionDeliveries.jobId))
      .where(
        and(
          eq(subscriptions.paused, false),
          eq(subscriptions.deliveryMode, "immediate"),
          or(
            eq(subscriptionDeliveries.state, "pending"),
            eq(subscriptionDeliveries.state, "failed"),
          ),
          lte(subscriptionDeliveries.nextAttemptAt, new Date()),
          eq(jobs.status, "open"),
        ),
      )
      .orderBy(asc(subscriptionDeliveries.createdAt))
      .limit(limit);
  }

  async listDueDigestSubscriptions(limit = 20): Promise<Subscription[]> {
    return this.db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.paused, false),
          eq(subscriptions.deliveryMode, "daily"),
          lte(subscriptions.nextDigestAt, new Date()),
        ),
      )
      .orderBy(asc(subscriptions.nextDigestAt))
      .limit(limit);
  }

  async listPendingDeliveriesForSubscription(subscriptionId: string, limit = 8) {
    return this.db
      .select({ delivery: subscriptionDeliveries, job: jobs })
      .from(subscriptionDeliveries)
      .innerJoin(jobs, eq(jobs.id, subscriptionDeliveries.jobId))
      .where(
        and(
          eq(subscriptionDeliveries.subscriptionId, subscriptionId),
          or(
            eq(subscriptionDeliveries.state, "pending"),
            eq(subscriptionDeliveries.state, "failed"),
          ),
          lte(subscriptionDeliveries.nextAttemptAt, new Date()),
          eq(jobs.status, "open"),
        ),
      )
      .orderBy(asc(subscriptionDeliveries.createdAt))
      .limit(limit);
  }

  async hasPendingSubscriptionDeliveries(subscriptionId: string): Promise<boolean> {
    const [delivery] = await this.db
      .select({ jobId: subscriptionDeliveries.jobId })
      .from(subscriptionDeliveries)
      .where(
        and(
          eq(subscriptionDeliveries.subscriptionId, subscriptionId),
          or(
            eq(subscriptionDeliveries.state, "pending"),
            eq(subscriptionDeliveries.state, "failed"),
          ),
        ),
      )
      .limit(1);
    return delivery !== undefined;
  }

  async markSubscriptionDeliveriesSent(
    subscriptionId: string,
    jobIds: string[],
    messageId: string,
  ): Promise<void> {
    if (jobIds.length === 0) return;
    await this.db
      .update(subscriptionDeliveries)
      .set({ state: "sent", messageId, sentAt: new Date(), lastError: null })
      .where(
        and(
          eq(subscriptionDeliveries.subscriptionId, subscriptionId),
          inArray(subscriptionDeliveries.jobId, jobIds),
        ),
      );
    await this.db
      .update(subscriptions)
      .set({ lastError: null, updatedAt: new Date() })
      .where(eq(subscriptions.id, subscriptionId));
  }

  async markSubscriptionDeliveriesFailed(
    subscription: Subscription,
    deliveries: Array<{ jobId: string; attempts: number }>,
    error: string,
    terminal = false,
  ): Promise<void> {
    for (const delivery of deliveries) {
      const attempts = delivery.attempts + 1;
      const dead = terminal || attempts >= 5;
      await this.db
        .update(subscriptionDeliveries)
        .set({
          state: dead ? "dead" : "failed",
          attempts,
          lastError: error.slice(0, 2_000),
          nextAttemptAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000),
        })
        .where(
          and(
            eq(subscriptionDeliveries.subscriptionId, subscription.id),
            eq(subscriptionDeliveries.jobId, delivery.jobId),
          ),
        );
    }
    await this.db
      .update(subscriptions)
      .set({
        paused: terminal,
        lastError: error.slice(0, 2_000),
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, subscription.id));
  }

  async advanceSubscriptionDigest(subscriptionId: string, nextAt: Date): Promise<void> {
    await this.db
      .update(subscriptions)
      .set({ nextDigestAt: nextAt, updatedAt: new Date() })
      .where(eq(subscriptions.id, subscriptionId));
  }

  async closePendingSubscriptionDeliveries(jobIds: string[]): Promise<void> {
    if (jobIds.length === 0) return;
    await this.db
      .update(subscriptionDeliveries)
      .set({ state: "dead", lastError: "Listing closed before delivery" })
      .where(
        and(
          inArray(subscriptionDeliveries.jobId, jobIds),
          or(
            eq(subscriptionDeliveries.state, "pending"),
            eq(subscriptionDeliveries.state, "failed"),
          ),
        ),
      );
  }

  async pruneSubscriptionDeliveryHistory(olderThan: Date): Promise<number> {
    const deleted = await this.db
      .delete(subscriptionDeliveries)
      .where(
        and(
          or(eq(subscriptionDeliveries.state, "sent"), eq(subscriptionDeliveries.state, "dead")),
          lt(subscriptionDeliveries.createdAt, olderThan),
        ),
      )
      .returning({ jobId: subscriptionDeliveries.jobId });
    return deleted.length;
  }
}
