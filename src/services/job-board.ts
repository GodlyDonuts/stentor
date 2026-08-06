import {
  ChannelType,
  DiscordAPIError,
  EmbedBuilder,
  MessageFlags,
  RESTJSONErrorCodes,
  type Client,
} from "discord.js";
import type { Repository } from "../db/repository.js";
import type { GuildSettings } from "../db/schema.js";
import { jobBoardContainer } from "../discord/presentation.js";
import type { Logger } from "../logger.js";

export class JobBoardPublisher {
  private readonly refreshes = new Map<string, Promise<string>>();

  public constructor(
    private readonly client: Client,
    private readonly repository: Repository,
    private readonly logger: Logger,
  ) {}

  refresh(settings: GuildSettings): Promise<string> {
    const active = this.refreshes.get(settings.guildId);
    if (active) return active;
    const refresh = this.refreshUnlocked(settings).finally(() => {
      if (this.refreshes.get(settings.guildId) === refresh) {
        this.refreshes.delete(settings.guildId);
      }
    });
    this.refreshes.set(settings.guildId, refresh);
    return refresh;
  }

  private async refreshUnlocked(settings: GuildSettings): Promise<string> {
    if (settings.deliveryMode !== "board")
      throw new Error("This server is not using live-board mode");
    const channel = await this.client.channels.fetch(settings.channelId);
    if (
      !channel?.isTextBased() ||
      channel.type === ChannelType.DM ||
      !("send" in channel) ||
      !("messages" in channel)
    ) {
      throw new Error("Configured live-board channel is unavailable or is not text-based");
    }
    const jobs = await this.repository.searchGuildBoardJobs(settings, null, 0, 6);
    const components = [
      jobBoardContainer(settings, jobs, this.client.user?.displayAvatarURL({ size: 256 })),
    ];
    let message = null;
    if (settings.boardMessageId) {
      try {
        message = await channel.messages.fetch(settings.boardMessageId);
      } catch (error) {
        if (
          !(error instanceof DiscordAPIError) ||
          error.code !== RESTJSONErrorCodes.UnknownMessage
        ) {
          throw error;
        }
      }
    }
    if (message) {
      const legacy = !message.flags.has(MessageFlags.IsComponentsV2);
      try {
        await message.edit({
          ...(legacy ? { content: null, embeds: [] } : {}),
          allowedMentions: { parse: [] },
          components,
          flags: MessageFlags.IsComponentsV2,
        });
      } catch (error) {
        if (!legacy) throw error;
        const previous = message;
        message = await channel.send({
          allowedMentions: { parse: [] },
          components,
          flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
        });
        await previous
          .edit({
            content: null,
            embeds: [
              new EmbedBuilder()
                .setColor(0x7c5cff)
                .setTitle("Stentor board upgraded")
                .setDescription(`[Open the new live dashboard](${message.url})`),
            ],
            components: [],
          })
          .catch(() => undefined);
        if (previous.pinned) await previous.unpin().catch(() => undefined);
      }
    } else {
      message = await channel.send({
        allowedMentions: { parse: [] },
        components,
        flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
      });
    }
    if (!message.pinned) {
      if (message.pinnable) {
        await message
          .pin("Stentor live job board")
          .catch((error: unknown) =>
            this.logger.warn(
              { error, guildId: settings.guildId, channelId: settings.channelId },
              "Live board could not be pinned",
            ),
          );
      } else {
        this.logger.warn(
          { guildId: settings.guildId, channelId: settings.channelId },
          "Live board is not pinnable; grant Manage Messages to pin it",
        );
      }
    }
    await this.repository.setGuildBoardMessage(settings.guildId, message.id);
    return message.id;
  }

  async refreshAll(): Promise<void> {
    const guilds = await this.repository.listActiveBoardGuilds();
    for (const settings of guilds) {
      await this.refresh(settings).catch((error: unknown) =>
        this.logger.error({ error, guildId: settings.guildId }, "Live board refresh failed"),
      );
    }
  }
}
