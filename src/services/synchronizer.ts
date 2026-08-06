import { matchesFilter, settingsToFilter } from "../domain/filter.js";
import type { Logger } from "../logger.js";
import type { Metrics } from "../metrics.js";
import type { Repository } from "../db/repository.js";
import type { KeryxClient } from "./keryx-client.js";
import type { SubscriptionMatcher } from "./subscriptions.js";

export class Synchronizer {
  private running = false;
  private timer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly client: KeryxClient,
    private readonly repository: Repository,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
    private readonly intervalMs: number,
    private readonly subscriptionMatcher: SubscriptionMatcher,
    private readonly deliveryRetentionDays: number,
  ) {}

  start(): void {
    void this.run().catch(() => undefined);
    this.timer = setInterval(() => void this.run().catch(() => undefined), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async fanOutPendingChanges(): Promise<number> {
    const changes = await this.repository.listPendingKeryxJobChanges();
    if (changes.length === 0) return 0;
    const guilds = await this.repository.listActiveGuilds();
    let newlyEligible = 0;
    for (const change of changes) {
      for (const guild of guilds) {
        const filter = settingsToFilter(guild);
        const matchesNow = matchesFilter(change.after, filter);
        const matchedBefore = change.before ? matchesFilter(change.before, filter) : false;
        if (matchesNow && !matchedBefore) {
          await this.repository.enqueueAnnouncement(
            guild.guildId,
            guild.channelId,
            change.after.id,
          );
          newlyEligible += 1;
        }
      }
    }
    await this.subscriptionMatcher.enqueueChanges(changes);
    await this.repository.deleteKeryxJobChanges(changes.map((change) => change.after.id));
    return newlyEligible;
  }

  async run(): Promise<{ changed: boolean; discovered: number; baseline: boolean }> {
    if (this.running) return { changed: false, discovered: 0, baseline: false };
    this.running = true;
    const end = this.metrics.syncDuration.startTimer();
    try {
      await this.repository.pruneSubscriptionDeliveryHistory(
        new Date(Date.now() - this.deliveryRetentionDays * 86_400_000),
      );
      const expired = await this.repository.closeExpiredAdminJobs();
      await this.repository.enqueueClosureUpdates(expired.map((job) => job.id));
      await this.repository.closePendingSubscriptionDeliveries(expired.map((job) => job.id));
      const state = await this.repository.getSyncState();
      const result = await this.client.fetch(state?.etag);
      if (!result.changed) {
        await this.repository.markSyncChecked(result.etag);
        await this.fanOutPendingChanges();
        this.metrics.syncs.inc({ result: "not_modified" });
        return { changed: false, discovered: 0, baseline: false };
      }

      const upserted = await this.repository.upsertKeryxJobs(result.payload.jobs, result.etag);
      await this.repository.enqueueClosureUpdates(upserted.closed.map((job) => job.id));
      await this.repository.closePendingSubscriptionDeliveries(
        upserted.closed.map((job) => job.id),
      );
      const newlyEligible = await this.fanOutPendingChanges();
      this.metrics.syncs.inc({ result: "success" });
      this.logger.info(
        {
          discovered: upserted.jobs.length,
          updated: upserted.updated.length,
          newlyEligible,
          total: result.payload.jobs.length,
          baseline: upserted.baseline,
        },
        "Keryx synchronization completed",
      );
      return { changed: true, discovered: upserted.jobs.length, baseline: upserted.baseline };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.repository.markSyncFailed(message).catch(() => undefined);
      this.metrics.syncs.inc({ result: "error" });
      this.logger.error({ error }, "Keryx synchronization failed");
      throw error;
    } finally {
      end();
      this.running = false;
    }
  }
}
