import { describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";
import type { Repository } from "../src/db/repository.js";
import type { Job, Subscription, SubscriptionDelivery } from "../src/db/schema.js";
import { createLogger } from "../src/logger.js";
import { createMetrics } from "../src/metrics.js";
import { SubscriptionNotifier, subscriptionMatches } from "../src/services/subscriptions.js";

const subscription = {
  id: "subscription-1",
  guildId: "guild-1",
  userId: "user-1",
  name: "Fall internships",
  programs: ["internship"],
  cycles: ["fall-2026"],
  keywords: ["software"],
  locations: ["remote"],
  sponsorship: "any",
  requireLink: true,
  remoteOnly: true,
  deliveryMode: "immediate",
  paused: false,
} as Subscription;

const job = {
  id: "job-1",
  source: "keryx",
  ownerGuildId: null,
  company: "Acme",
  title: "Software Engineering Intern",
  location: "Remote, US",
  program: "internship",
  cycle: "fall-2026",
  sponsorship: null,
  url: "https://jobs.example.com/1",
  linkStatus: "ats-verified",
  description: null,
  postedAt: null,
  status: "open",
  firstSeen: new Date(),
  createdAt: new Date(),
} as Job;

describe("subscriptionMatches", () => {
  it("matches a global Keryx job against every selected category", () => {
    expect(subscriptionMatches(subscription, job)).toBe(true);
  });

  it("keeps community jobs scoped to their originating server", () => {
    expect(
      subscriptionMatches(subscription, { ...job, source: "admin", ownerGuildId: "guild-2" }),
    ).toBe(false);
  });
});

describe("SubscriptionNotifier", () => {
  it("delivers and acknowledges an immediate private alert", async () => {
    const send = vi.fn().mockResolvedValue({ id: "dm-message-1" });
    const markSent = vi.fn().mockResolvedValue(undefined);
    const repository = {
      listPendingImmediateDeliveries: vi.fn().mockResolvedValue([
        {
          subscription,
          job,
          delivery: {
            subscriptionId: subscription.id,
            jobId: job.id,
            attempts: 0,
          } as SubscriptionDelivery,
        },
      ]),
      listDueDigestSubscriptions: vi.fn().mockResolvedValue([]),
      markSubscriptionDeliveriesSent: markSent,
    } as unknown as Repository;
    const client = {
      isReady: () => true,
      users: { fetch: vi.fn().mockResolvedValue({ send }) },
    } as unknown as Client;
    const notifier = new SubscriptionNotifier(
      client,
      repository,
      createLogger({ LOG_LEVEL: "silent", NODE_ENV: "test" }),
      createMetrics(),
      5_000,
    );

    await notifier.run();

    expect(send).toHaveBeenCalledOnce();
    expect(markSent).toHaveBeenCalledWith(subscription.id, [job.id], "dm-message-1");
  });

  it("pauses an alert when Discord DMs are disabled", async () => {
    const markFailed = vi.fn().mockResolvedValue(undefined);
    const repository = {
      listPendingImmediateDeliveries: vi.fn().mockResolvedValue([
        {
          subscription,
          job,
          delivery: {
            subscriptionId: subscription.id,
            jobId: job.id,
            attempts: 0,
          } as SubscriptionDelivery,
        },
      ]),
      listDueDigestSubscriptions: vi.fn().mockResolvedValue([]),
      markSubscriptionDeliveriesFailed: markFailed,
    } as unknown as Repository;
    const client = {
      isReady: () => true,
      users: {
        fetch: vi.fn().mockResolvedValue({ send: vi.fn().mockRejectedValue({ code: 50_007 }) }),
      },
    } as unknown as Client;
    const notifier = new SubscriptionNotifier(
      client,
      repository,
      createLogger({ LOG_LEVEL: "silent", NODE_ENV: "test" }),
      createMetrics(),
      5_000,
    );

    await notifier.run();

    expect(markFailed).toHaveBeenCalledWith(
      subscription,
      [{ jobId: job.id, attempts: 0 }],
      expect.stringContaining("Direct messages are disabled"),
      true,
    );
  });
});
