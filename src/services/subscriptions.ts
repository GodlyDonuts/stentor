import { DiscordAPIError, type Client } from "discord.js";
import type { Job, Subscription } from "../db/schema.js";
import type { KeryxJobChange, Repository } from "../db/repository.js";
import { matchesFilter } from "../domain/filter.js";
import { nextDigestAt } from "../domain/schedule.js";
import { applicationButton, digestEmbed, jobEmbed } from "../discord/presentation.js";
import type { Logger } from "../logger.js";
import type { Metrics } from "../metrics.js";

export function subscriptionMatches(subscription: Subscription, job: Job): boolean {
  if (job.source !== "keryx" && job.ownerGuildId !== subscription.guildId) return false;
  return matchesFilter(job, {
    programs: subscription.programs,
    cycles: subscription.cycles,
    keywords: subscription.keywords,
    locations: subscription.locations,
    requireLink: subscription.requireLink,
    remoteOnly: subscription.remoteOnly,
    sponsorship: subscription.sponsorship,
  });
}

export class SubscriptionMatcher {
  public constructor(private readonly repository: Repository) {}

  async enqueue(jobs: Job[]): Promise<number> {
    return this.enqueueChanges(jobs.map((after) => ({ before: null, after })));
  }

  async enqueueChanges(changes: KeryxJobChange[]): Promise<number> {
    if (changes.length === 0) return 0;
    const subscriptions = await this.repository.listActiveSubscriptions();
    const deliveries: Array<{ subscriptionId: string; jobId: string }> = [];
    for (const change of changes) {
      for (const subscription of subscriptions) {
        const matchesNow = subscriptionMatches(subscription, change.after);
        const matchedBefore = change.before
          ? subscriptionMatches(subscription, change.before)
          : false;
        if (matchesNow && !matchedBefore) {
          deliveries.push({ subscriptionId: subscription.id, jobId: change.after.id });
        }
      }
    }
    return this.repository.enqueueSubscriptionDeliveries(deliveries);
  }
}

function isDmBlocked(error: unknown): boolean {
  if (error instanceof DiscordAPIError) return Number(error.code) === 50_007;
  return (
    typeof error === "object" && error !== null && "code" in error && Number(error.code) === 50_007
  );
}

export class SubscriptionNotifier {
  private running = false;
  private timer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly client: Client,
    private readonly repository: Repository,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    void this.run().catch((error: unknown) =>
      this.logger.error({ error }, "Subscription notification worker failed"),
    );
    this.timer = setInterval(
      () =>
        void this.run().catch((error: unknown) =>
          this.logger.error({ error }, "Subscription notification worker failed"),
        ),
      this.intervalMs,
    );
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    if (this.running || !this.client.isReady()) return;
    this.running = true;
    let handled = 0;
    try {
      handled += await this.deliverImmediate();
      handled += await this.deliverDigests();
      this.metrics.subscriptionQueue.set(handled);
    } finally {
      this.running = false;
    }
  }

  private async deliverImmediate(): Promise<number> {
    const deliveries = await this.repository.listPendingImmediateDeliveries(24);
    const grouped = new Map<
      string,
      { subscription: Subscription; jobs: Job[]; attempts: Map<string, number> }
    >();
    for (const item of deliveries) {
      const group = grouped.get(item.subscription.id) ?? {
        subscription: item.subscription,
        jobs: [],
        attempts: new Map<string, number>(),
      };
      if (group.jobs.length < 8) {
        group.jobs.push(item.job);
        group.attempts.set(item.job.id, item.delivery.attempts);
      }
      grouped.set(item.subscription.id, group);
    }
    for (const group of grouped.values()) {
      await this.deliver(group.subscription, group.jobs, group.attempts, "immediate");
    }
    return deliveries.length;
  }

  private async deliverDigests(): Promise<number> {
    const due = await this.repository.listDueDigestSubscriptions();
    let handled = 0;
    for (const subscription of due) {
      const deliveries = await this.repository.listPendingDeliveriesForSubscription(
        subscription.id,
        8,
      );
      if (deliveries.length > 0) {
        await this.deliver(
          subscription,
          deliveries.map((item) => item.job),
          new Map(deliveries.map((item) => [item.job.id, item.delivery.attempts])),
          "daily",
        );
        handled += deliveries.length;
      }
      if (!(await this.repository.hasPendingSubscriptionDeliveries(subscription.id))) {
        await this.repository.advanceSubscriptionDigest(
          subscription.id,
          nextDigestAt(subscription.timezone, subscription.digestHour),
        );
      }
    }
    return handled;
  }

  private async deliver(
    subscription: Subscription,
    jobs: Job[],
    attempts: Map<string, number>,
    mode: "immediate" | "daily",
  ): Promise<void> {
    if (jobs.length === 0) return;
    try {
      const user = await this.client.users.fetch(subscription.userId);
      const row = jobs.length === 1 ? applicationButton(jobs[0]!) : null;
      const content =
        mode === "immediate"
          ? `New match for **${subscription.name.replaceAll("*", "\\*")}**`
          : `Daily digest for **${subscription.name.replaceAll("*", "\\*")}**`;
      const message = await user.send({
        ...(content ? { content } : {}),
        allowedMentions: { parse: [] },
        embeds: jobs.length === 1 ? [jobEmbed(jobs[0]!)] : [digestEmbed(subscription, jobs)],
        components: row ? [row] : [],
      });
      await this.repository.markSubscriptionDeliveriesSent(
        subscription.id,
        jobs.map((job) => job.id),
        message.id,
      );
      this.metrics.subscriptionNotifications.inc({ mode, result: "sent" });
    } catch (error) {
      const terminal = isDmBlocked(error);
      const message = terminal
        ? "Direct messages are disabled for this server. Enable DMs, then resume the alert."
        : error instanceof Error
          ? error.message
          : String(error);
      await this.repository.markSubscriptionDeliveriesFailed(
        subscription,
        jobs.map((job) => ({ jobId: job.id, attempts: attempts.get(job.id) ?? 0 })),
        message,
        terminal,
      );
      this.metrics.subscriptionNotifications.inc({ mode, result: terminal ? "blocked" : "failed" });
      this.logger.warn(
        { error, subscriptionId: subscription.id, guildId: subscription.guildId },
        "Personal alert delivery failed",
      );
    }
  }
}
