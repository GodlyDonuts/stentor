import { describe, expect, it, vi } from "vitest";
import type { Repository } from "../src/db/repository.js";
import type { GuildSettings, Job } from "../src/db/schema.js";
import { createLogger } from "../src/logger.js";
import { createMetrics } from "../src/metrics.js";
import type { KeryxClient } from "../src/services/keryx-client.js";
import type { SubscriptionMatcher } from "../src/services/subscriptions.js";
import { Synchronizer } from "../src/services/synchronizer.js";

const before = {
  id: "job-transition",
  source: "keryx",
  ownerGuildId: null,
  company: "TikTok",
  title: "Software Engineer Intern",
  location: "United States",
  program: "internship",
  cycle: "summer-2027",
  sponsorship: null,
  url: null,
  status: "open",
} as Job;

const after = {
  ...before,
  url: "https://lifeattiktok.com/search/123",
  linkStatus: "cross-source",
} as Job;

describe("Synchronizer", () => {
  it("fans out an existing job when an update makes it newly eligible", async () => {
    const enqueueAnnouncement = vi.fn().mockResolvedValue(undefined);
    const deleteKeryxJobChanges = vi.fn().mockResolvedValue(undefined);
    const repository = {
      pruneSubscriptionDeliveryHistory: vi.fn().mockResolvedValue(undefined),
      closeExpiredAdminJobs: vi.fn().mockResolvedValue([]),
      enqueueClosureUpdates: vi.fn().mockResolvedValue(undefined),
      closePendingSubscriptionDeliveries: vi.fn().mockResolvedValue(undefined),
      getSyncState: vi.fn().mockResolvedValue({ etag: "old" }),
      upsertKeryxJobs: vi.fn().mockResolvedValue({
        jobs: [],
        updated: [{ before, after }],
        closed: [],
        baseline: false,
      }),
      listPendingKeryxJobChanges: vi.fn().mockResolvedValue([{ before, after }]),
      listActiveGuilds: vi.fn().mockResolvedValue([
        {
          guildId: "guild-1",
          channelId: "channel-1",
          pingRoleId: null,
          deliveryMode: "board",
          boardMessageId: null,
          boardUpdatedAt: null,
          programs: ["internship"],
          cycles: ["summer-2027"],
          keywords: [],
          locations: [],
          sponsorship: "any",
          requireLink: true,
          remoteOnly: false,
          paused: false,
          configuredBy: "admin-1",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as GuildSettings,
      ]),
      enqueueAnnouncement,
      deleteKeryxJobChanges,
    } as unknown as Repository;
    const client = {
      fetch: vi.fn().mockResolvedValue({
        changed: true,
        etag: "new",
        payload: { schema_version: 1, country: "United States", jobs: [] },
      }),
    } as unknown as KeryxClient;
    const enqueueChanges = vi.fn().mockResolvedValue(0);
    const subscriptionMatcher = { enqueueChanges } as unknown as SubscriptionMatcher;
    const synchronizer = new Synchronizer(
      client,
      repository,
      createLogger({ LOG_LEVEL: "silent", NODE_ENV: "test" }),
      createMetrics(),
      900_000,
      subscriptionMatcher,
      90,
    );

    const result = await synchronizer.run();

    expect(result).toEqual({ changed: true, discovered: 0, baseline: false });
    expect(enqueueAnnouncement).toHaveBeenCalledWith("guild-1", "channel-1", after.id);
    expect(enqueueChanges).toHaveBeenCalledWith([{ before, after }]);
    expect(deleteKeryxJobChanges).toHaveBeenCalledWith([after.id]);
  });

  it("retries a durable fan-out event even when Keryx is unchanged", async () => {
    const enqueueAnnouncement = vi.fn().mockResolvedValue(undefined);
    const deleteKeryxJobChanges = vi.fn().mockResolvedValue(undefined);
    const repository = {
      pruneSubscriptionDeliveryHistory: vi.fn().mockResolvedValue(undefined),
      closeExpiredAdminJobs: vi.fn().mockResolvedValue([]),
      enqueueClosureUpdates: vi.fn().mockResolvedValue(undefined),
      closePendingSubscriptionDeliveries: vi.fn().mockResolvedValue(undefined),
      getSyncState: vi.fn().mockResolvedValue({ etag: "current" }),
      markSyncChecked: vi.fn().mockResolvedValue(undefined),
      listPendingKeryxJobChanges: vi.fn().mockResolvedValue([{ before, after }]),
      listActiveGuilds: vi.fn().mockResolvedValue([
        {
          guildId: "guild-1",
          channelId: "channel-1",
          pingRoleId: null,
          deliveryMode: "board",
          boardMessageId: null,
          boardUpdatedAt: null,
          programs: ["internship"],
          cycles: ["summer-2027"],
          keywords: [],
          locations: [],
          sponsorship: "any",
          requireLink: true,
          remoteOnly: false,
          paused: false,
          configuredBy: "admin-1",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as GuildSettings,
      ]),
      enqueueAnnouncement,
      deleteKeryxJobChanges,
    } as unknown as Repository;
    const client = {
      fetch: vi.fn().mockResolvedValue({ changed: false, etag: "current" }),
    } as unknown as KeryxClient;
    const enqueueChanges = vi.fn().mockResolvedValue(0);
    const synchronizer = new Synchronizer(
      client,
      repository,
      createLogger({ LOG_LEVEL: "silent", NODE_ENV: "test" }),
      createMetrics(),
      900_000,
      { enqueueChanges } as unknown as SubscriptionMatcher,
      90,
    );

    const result = await synchronizer.run();

    expect(result).toEqual({ changed: false, discovered: 0, baseline: false });
    expect(enqueueAnnouncement).toHaveBeenCalledWith("guild-1", "channel-1", after.id);
    expect(deleteKeryxJobChanges).toHaveBeenCalledWith([after.id]);
  });
});
