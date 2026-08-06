import { ChannelType, type Client } from "discord.js";
import type { Repository } from "../db/repository.js";
import type { Logger } from "../logger.js";
import type { Metrics } from "../metrics.js";
import { applicationButton, jobEmbed } from "../discord/presentation.js";
import type { JobBoardPublisher } from "./job-board.js";

export class Announcer {
  private running = false;
  private timer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly client: Client,
    private readonly repository: Repository,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
    private readonly intervalMs: number,
    private readonly jobBoard: JobBoardPublisher,
  ) {}

  start(): void {
    void this.run().catch((error: unknown) =>
      this.logger.error({ error }, "Announcement worker failed"),
    );
    this.timer = setInterval(
      () =>
        void this.run().catch((error: unknown) =>
          this.logger.error({ error }, "Announcement worker failed"),
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
    try {
      const pending = await this.repository.listPendingAnnouncements();
      const boardGroups = new Map<string, typeof pending>();
      for (const item of pending) {
        if (item.settings.deliveryMode !== "board") continue;
        const group = boardGroups.get(item.announcement.guildId) ?? [];
        group.push(item);
        boardGroups.set(item.announcement.guildId, group);
      }
      for (const items of boardGroups.values()) {
        const first = items[0];
        if (!first) continue;
        try {
          const messageId = await this.jobBoard.refresh(first.settings);
          for (const item of items) {
            await this.repository.markAnnouncementSent(
              item.announcement.guildId,
              item.announcement.jobId,
              messageId,
            );
            this.metrics.announcements.inc({ result: "sent" });
          }
          this.logger.info(
            { guildId: first.settings.guildId, jobs: items.length },
            "Live job board refreshed",
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          for (const item of items) {
            await this.repository.markAnnouncementFailed(
              item.announcement.guildId,
              item.announcement.jobId,
              item.announcement.attempts,
              message,
            );
            this.metrics.announcements.inc({ result: "failed" });
          }
          this.logger.warn(
            { error, guildId: first.settings.guildId, jobs: items.length },
            "Live job board refresh failed",
          );
        }
      }
      for (const item of pending) {
        if (item.settings.deliveryMode === "board") continue;
        try {
          const channel = await this.client.channels.fetch(item.announcement.channelId);
          if (!channel?.isTextBased() || channel.type === ChannelType.DM || !("send" in channel)) {
            throw new Error("Configured announcement channel is unavailable or is not text-based");
          }
          const row = applicationButton(item.job);
          const ping = item.settings.pingRoleId ? `<@&${item.settings.pingRoleId}>` : undefined;
          let messageId: string;
          if (item.announcement.action === "close" && item.announcement.messageId) {
            if (!("messages" in channel)) {
              throw new Error("Cannot edit messages in the configured channel");
            }
            const message = await channel.messages.fetch(item.announcement.messageId);
            await message.edit({ embeds: [jobEmbed(item.job)], components: [] });
            messageId = message.id;
          } else {
            const message = await channel.send({
              ...(ping ? { content: ping } : {}),
              allowedMentions: item.settings.pingRoleId
                ? { roles: [item.settings.pingRoleId] }
                : { parse: [] },
              embeds: [jobEmbed(item.job)],
              components: row ? [row] : [],
            });
            messageId = message.id;
          }
          await this.repository.markAnnouncementSent(
            item.announcement.guildId,
            item.announcement.jobId,
            messageId,
          );
          this.metrics.announcements.inc({ result: "sent" });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.repository.markAnnouncementFailed(
            item.announcement.guildId,
            item.announcement.jobId,
            item.announcement.attempts,
            message,
          );
          this.metrics.announcements.inc({ result: "failed" });
          this.logger.warn(
            { error, guildId: item.announcement.guildId, jobId: item.announcement.jobId },
            "Announcement delivery failed",
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
