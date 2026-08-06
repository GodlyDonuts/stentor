import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  escapeMarkdown,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { Repository } from "../db/repository.js";
import type { GuildSettings, Job } from "../db/schema.js";
import { normalizeCsv } from "../domain/filter.js";
import {
  NOTIFICATION_ROLE_NONE,
  notificationCategoryKey,
  notificationRoleName,
  parseNotificationCategoryKey,
  type NotificationCategory,
} from "../domain/notification-role.js";
import { nextDigestAt, supportedTimezones, type SupportedTimezone } from "../domain/schedule.js";
import type { JobSearchFilters } from "../domain/search.js";
import { validatePublicHttpsUrl } from "../domain/url.js";
import type { Logger } from "../logger.js";
import {
  boardHelpContainer,
  jobEmbed,
  jobBrowserContainer,
  notificationRolePicker,
  searchNavigation,
  subscriptionEmbed,
} from "./presentation.js";
import { SearchSessions } from "./search-sessions.js";

interface HandlerDependencies {
  client: Client;
  repository: Repository;
  logger: Logger;
  syncNow: () => Promise<{ changed: boolean; discovered: number; baseline: boolean }>;
  announceNow: () => Promise<void>;
  notifyNow: () => Promise<void>;
  enqueuePersonalMatches: (jobs: Job[]) => Promise<number>;
  refreshBoard: (settings: GuildSettings) => Promise<string>;
}

const ephemeral = MessageFlags.Ephemeral;

function configuredSummary(
  settings: NonNullable<Awaited<ReturnType<Repository["getGuildSettings"]>>>,
) {
  const list = (values: string[], fallback: string) =>
    values.length > 0 ? values.join(", ") : fallback;
  return new EmbedBuilder()
    .setColor(settings.paused ? 0xf59e0b : 0x16a085)
    .setTitle("Stentor configuration")
    .setDescription(
      settings.paused ? "⏸️ Announcements are paused." : "✅ Announcements are active.",
    )
    .addFields(
      { name: "Channel", value: `<#${settings.channelId}>`, inline: true },
      {
        name: "Display",
        value: settings.deliveryMode === "board" ? "Live interactive board" : "Announcement feed",
        inline: true,
      },
      {
        name: "Ping role",
        value:
          settings.deliveryMode === "board"
            ? "Disabled in live-board mode"
            : settings.pingRoleId
              ? `<@&${settings.pingRoleId}>`
              : "None",
        inline: true,
      },
      { name: "Programs", value: list(settings.programs, "All"), inline: true },
      { name: "Cycles", value: list(settings.cycles, "All") },
      { name: "Keywords", value: list(settings.keywords, "Any") },
      { name: "Locations", value: list(settings.locations, "Any") },
      { name: "Sponsorship", value: settings.sponsorship, inline: true },
      {
        name: "Work arrangement",
        value: settings.remoteOnly ? "Remote only" : "Any",
        inline: true,
      },
      {
        name: "Application link",
        value: settings.requireLink ? "Required" : "Optional",
        inline: true,
      },
    )
    .setTimestamp(settings.updatedAt);
}

function requireGuild(interaction: ChatInputCommandInteraction): string {
  if (!interaction.guildId) throw new Error("This command can only be used in a server.");
  return interaction.guildId;
}

function requireManageGuild(interaction: ChatInputCommandInteraction): void {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new Error("You need the Manage Server permission to do that.");
  }
}

async function renderSearch(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  repository: Repository,
  guildId: string,
  filters: JobSearchFilters,
  offset: number,
  token: string,
): Promise<void> {
  const results = await repository.searchJobs(guildId, filters, offset, 6);
  const visible = results.slice(0, 5);
  const filterLabels = [
    filters.query ? `“${escapeMarkdown(filters.query)}”` : null,
    filters.program,
    filters.cycle,
    filters.location,
    filters.remoteOnly ? "remote" : null,
    filters.sponsorship,
    filters.requireLink ? "with application links" : null,
  ].filter((value): value is string => Boolean(value));
  const content = visible.length
    ? `Showing open roles ${offset + 1}–${offset + visible.length}${filterLabels.length > 0 ? ` matching **${filterLabels.join(" · ")}**` : ""}.`
    : offset === 0
      ? "No open roles matched those filters."
      : "There are no more matching roles.";
  const payload = {
    content,
    allowedMentions: { parse: [] },
    embeds: visible.map(jobEmbed),
    components: visible.length > 0 ? [searchNavigation(token, offset, results.length > 5)] : [],
  };
  if (interaction.isButton()) await interaction.update(payload);
  else await interaction.reply({ ...payload, flags: ephemeral });
}

async function renderBoardBrowse(
  interaction: ButtonInteraction,
  repository: Repository,
  guildId: string,
  program: string | null,
  offset: number,
  initial: boolean,
): Promise<void> {
  const settings = await repository.getGuildSettings(guildId);
  if (!settings || settings.deliveryMode !== "board") {
    throw new Error("This live board is no longer configured.");
  }
  const results = await repository.searchGuildBoardJobs(settings, program, offset, 6);
  const visible = results.slice(0, 5);
  const payload = {
    allowedMentions: { parse: [] as never[] },
    components: [jobBrowserContainer(settings, visible, program, offset, results.length > 5)],
  };
  if (initial) {
    await interaction.reply({
      ...payload,
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
  } else await interaction.update(payload);
}

async function handleConfigure(
  interaction: ChatInputCommandInteraction,
  dependencies: HandlerDependencies,
) {
  requireManageGuild(interaction);
  const guildId = requireGuild(interaction);
  await interaction.deferReply({ flags: ephemeral });
  const channel = interaction.options.getChannel("channel", true);
  const role = interaction.options.getRole("ping_role");
  if (role?.id === guildId) throw new Error("Choose a role other than @everyone.");
  const botMember = interaction.guild?.members.me;
  const permissions =
    botMember && "permissionsFor" in channel ? channel.permissionsFor(botMember) : null;
  if (
    permissions &&
    (!permissions.has(PermissionFlagsBits.ViewChannel) ||
      !permissions.has(PermissionFlagsBits.SendMessages) ||
      !permissions.has(PermissionFlagsBits.EmbedLinks))
  ) {
    throw new Error("I need View Channel, Send Messages, and Embed Links in that channel.");
  }
  const selectedProgram = interaction.options.getString("program") ?? "all";
  const settings = await dependencies.repository.configureGuild({
    guildId,
    channelId: channel.id,
    pingRoleId: role?.id ?? null,
    deliveryMode: (interaction.options.getString("display") ?? "board") as
      | "board"
      | "announcements",
    programs: selectedProgram === "all" ? [] : [selectedProgram],
    cycles: normalizeCsv(interaction.options.getString("cycles")),
    keywords: normalizeCsv(interaction.options.getString("keywords")),
    locations: normalizeCsv(interaction.options.getString("locations")),
    sponsorship: interaction.options.getString("sponsorship") ?? "any",
    requireLink: interaction.options.getBoolean("require_link") ?? false,
    remoteOnly: interaction.options.getBoolean("remote_only") ?? false,
    configuredBy: interaction.user.id,
  });
  const boardMessageId =
    settings.deliveryMode === "board" ? await dependencies.refreshBoard(settings) : null;
  await interaction.editReply({
    content:
      settings.deliveryMode === "board"
        ? `Configuration saved. The live board is ready${boardMessageId ? `: https://discord.com/channels/${guildId}/${settings.channelId}/${boardMessageId}` : "."}`
        : "Configuration saved. Only newly eligible roles will be announced; the existing Keryx catalog remains the baseline.",
    embeds: [configuredSummary(settings)],
  });
}

async function handleStentor(
  interaction: ChatInputCommandInteraction,
  dependencies: HandlerDependencies,
) {
  const guildId = requireGuild(interaction);
  requireManageGuild(interaction);
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "configure") return handleConfigure(interaction, dependencies);
  if (subcommand === "status") {
    const settings = await dependencies.repository.getGuildSettings(guildId);
    const state = await dependencies.repository.getSyncState();
    if (!settings) {
      await interaction.reply({
        content: "Stentor is not configured. Start with `/stentor configure`.",
        flags: ephemeral,
      });
      return;
    }
    const health = state?.lastSuccessAt
      ? `Last Keryx refresh: <t:${Math.floor(state.lastSuccessAt.getTime() / 1_000)}:R> · ${state.jobsSeen.toLocaleString()} indexed roles`
      : "Keryx has not completed its first refresh yet.";
    await interaction.reply({
      content: health,
      embeds: [configuredSummary(settings)],
      flags: ephemeral,
    });
    return;
  }
  if (subcommand === "pause" || subcommand === "resume") {
    const paused = subcommand === "pause";
    const changed = await dependencies.repository.setGuildPaused(guildId, paused);
    await interaction.reply({
      content: changed
        ? paused
          ? "Announcements paused. Pending jobs will be retained."
          : "Announcements resumed. Pending jobs will now be delivered."
        : "Stentor is not configured. Start with `/stentor configure`.",
      flags: ephemeral,
    });
    if (!paused) {
      const settings = await dependencies.repository.getGuildSettings(guildId);
      if (settings?.deliveryMode === "board") await dependencies.refreshBoard(settings);
      void dependencies
        .announceNow()
        .catch((error: unknown) =>
          dependencies.logger.error({ error }, "Announcement wake-up failed"),
        );
    }
    return;
  }
  if (subcommand === "board") {
    const settings = await dependencies.repository.getGuildSettings(guildId);
    if (!settings) throw new Error("Stentor is not configured. Start with `/stentor configure`.");
    if (settings.deliveryMode !== "board") {
      throw new Error(
        "This server uses announcement mode. Reconfigure it with display: Live board.",
      );
    }
    await interaction.deferReply({ flags: ephemeral });
    const messageId = await dependencies.refreshBoard(settings);
    await interaction.editReply(
      `Live board refreshed: https://discord.com/channels/${guildId}/${settings.channelId}/${messageId}`,
    );
    return;
  }
  if (subcommand === "sync") {
    await interaction.deferReply({ flags: ephemeral });
    const result = await dependencies.syncNow();
    await interaction.editReply(
      result.changed
        ? `Keryx refresh complete. ${result.discovered.toLocaleString()} newly discovered role(s).${result.baseline ? " Initial catalog baseline created." : ""}`
        : "Keryx is already current.",
    );
  }
}

async function handleJobAdmin(
  interaction: ChatInputCommandInteraction,
  dependencies: HandlerDependencies,
) {
  requireManageGuild(interaction);
  const guildId = requireGuild(interaction);
  const settings = await dependencies.repository.getGuildSettings(guildId);
  if (!settings)
    throw new Error("Configure Stentor with `/stentor configure` before publishing jobs.");
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "post") {
    const checked = validatePublicHttpsUrl(interaction.options.getString("url", true));
    if (!checked.ok) throw new Error(checked.reason);
    const expiresInDays = interaction.options.getInteger("expires_in_days");
    const job = await dependencies.repository.createAdminJob({
      guildId,
      postedBy: interaction.user.id,
      company: interaction.options.getString("company", true).trim(),
      title: interaction.options.getString("title", true).trim(),
      location: interaction.options.getString("location", true).trim(),
      url: checked.url,
      urlHost: checked.host,
      program: interaction.options.getString("program", true) as
        | "internship"
        | "new-grad"
        | "experienced",
      description: interaction.options.getString("description")?.trim(),
      cycle: interaction.options.getString("cycle")?.trim().toLocaleLowerCase("en-US"),
      closesAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null,
    });
    await dependencies.repository.enqueueAnnouncement(guildId, settings.channelId, job.id);
    await dependencies.enqueuePersonalMatches([job]);
    await interaction.reply({
      content:
        settings.deliveryMode === "board"
          ? `Added **${job.company} — ${job.title}** to the live-board refresh queue. Job ID: \`${job.id}\``
          : `Queued **${job.company} — ${job.title}** for <#${settings.channelId}>. Job ID: \`${job.id}\``,
      flags: ephemeral,
    });
    void dependencies
      .announceNow()
      .catch((error: unknown) =>
        dependencies.logger.error({ error }, "Announcement wake-up failed"),
      );
    return;
  }

  const jobId = interaction.options.getString("job_id", true);
  const job = await dependencies.repository.closeAdminJob(guildId, jobId);
  if (!job) throw new Error("That admin-authored job was not found in this server.");
  const announcement = await dependencies.repository.getAnnouncement(guildId, jobId);
  if (settings.deliveryMode === "board") {
    await dependencies.refreshBoard(settings);
  } else if (announcement?.messageId) {
    try {
      const channel = await dependencies.client.channels.fetch(announcement.channelId);
      if (channel?.isTextBased() && "messages" in channel) {
        const message = await channel.messages.fetch(announcement.messageId);
        await message.edit({ embeds: [jobEmbed(job)], components: [] });
      }
    } catch (error) {
      dependencies.logger.warn(
        { error, guildId, jobId },
        "Could not update the closed job message",
      );
    }
  }
  await interaction.reply({
    content: `Closed **${job.company} — ${job.title}**.`,
    flags: ephemeral,
  });
}

async function handleAlerts(
  interaction: ChatInputCommandInteraction,
  dependencies: HandlerDependencies,
): Promise<void> {
  const guildId = requireGuild(interaction);
  const userId = interaction.user.id;
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "roles") {
    const settings = await dependencies.repository.getGuildSettings(guildId);
    if (!settings) throw new Error("An administrator must configure Stentor first.");
    if (!interaction.guild?.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      throw new Error("Stentor needs Manage Roles to offer opt-in channel pings.");
    }
    const [available, selected] = await Promise.all([
      dependencies.repository.listAvailableNotificationCategories(guildId),
      dependencies.repository.listUserNotificationCategories(guildId, userId),
    ]);
    const selectedKeys = new Set(selected.map(notificationCategoryKey));
    const categories = available
      .filter(
        (category) =>
          (settings.programs.length === 0 || settings.programs.includes(category.program)) &&
          (settings.cycles.length === 0 || settings.cycles.includes(category.cycle)),
      )
      .sort((left, right) => {
        const selectedOrder =
          Number(selectedKeys.has(notificationCategoryKey(right))) -
          Number(selectedKeys.has(notificationCategoryKey(left)));
        return (
          selectedOrder ||
          notificationCategoryKey(left).localeCompare(notificationCategoryKey(right))
        );
      })
      .slice(0, 24);
    await interaction.reply({
      content:
        "Choose broad channel pings below. For keywords, location, remote work, sponsorship, timing, and daily delivery, use `/alerts create` for a private DM alert.",
      components: [notificationRolePicker(categories, selected)],
      flags: ephemeral,
    });
    return;
  }

  if (subcommand === "create") {
    const name = interaction.options.getString("name", true).trim();
    if (!name) throw new Error("Alert name cannot be blank.");
    const current = await dependencies.repository.listUserSubscriptions(guildId, userId);
    const replacing = current.some(
      (subscription) => subscription.nameKey === name.toLocaleLowerCase("en-US"),
    );
    if (!replacing && current.length >= 5) {
      throw new Error(
        "You can keep up to five alerts per server. Delete one before adding another.",
      );
    }
    const selectedProgram = interaction.options.getString("program") ?? "all";
    const timezone = (interaction.options.getString("timezone") ??
      "America/New_York") as SupportedTimezone;
    if (!supportedTimezones.includes(timezone)) throw new Error("Unsupported timezone.");
    const digestHour = interaction.options.getInteger("digest_hour") ?? 9;
    const deliveryMode = (interaction.options.getString("delivery") ?? "daily") as
      | "daily"
      | "immediate";
    const subscription = await dependencies.repository.saveSubscription({
      guildId,
      userId,
      name,
      programs: selectedProgram === "all" ? [] : [selectedProgram],
      cycles: normalizeCsv(interaction.options.getString("cycles")),
      keywords: normalizeCsv(interaction.options.getString("keywords")),
      locations: normalizeCsv(interaction.options.getString("locations")),
      sponsorship: interaction.options.getString("sponsorship") ?? "any",
      requireLink: interaction.options.getBoolean("require_link") ?? true,
      remoteOnly: interaction.options.getBoolean("remote_only") ?? false,
      deliveryMode,
      timezone,
      digestHour,
      nextDigestAt: nextDigestAt(timezone, digestHour),
    });
    await dependencies.repository.discardPendingSubscriptionDeliveries(subscription.id);
    await interaction.reply({
      content: `${replacing ? "Updated" : "Created"} your private **${escapeMarkdown(name)}** alert. It starts with the next newly discovered job; use \`/alerts preview\` to inspect current matches.`,
      embeds: [subscriptionEmbed(subscription)],
      allowedMentions: { parse: [] },
      flags: ephemeral,
    });
    return;
  }

  if (subcommand === "manage") {
    const subscriptions = await dependencies.repository.listUserSubscriptions(guildId, userId);
    await interaction.reply({
      content:
        subscriptions.length > 0
          ? `You have ${subscriptions.length}/5 private alert${subscriptions.length === 1 ? "" : "s"}.`
          : "You have no saved alerts. Create one with `/alerts create`.",
      embeds: subscriptions.map(subscriptionEmbed),
      flags: ephemeral,
    });
    return;
  }

  if (subcommand === "forget-me") {
    if (!interaction.options.getBoolean("confirm", true)) {
      throw new Error("Set confirm to True to permanently delete your personal data.");
    }
    const [deleted, deletedRoleChoices] = await Promise.all([
      dependencies.repository.deleteUserSubscriptions(userId),
      dependencies.repository.deleteUserNotificationCategories(userId),
    ]);
    await interaction.reply({
      content: `Deleted ${deleted} personal alert${deleted === 1 ? "" : "s"}, ${deletedRoleChoices} role choice${deletedRoleChoices === 1 ? "" : "s"}, and all associated delivery history. Run \`/alerts roles\` in any server where you also want the visible Discord role removed.`,
      flags: ephemeral,
    });
    return;
  }

  const name = interaction.options.getString("name", true);
  if (subcommand === "delete") {
    const deleted = await dependencies.repository.deleteSubscription(guildId, userId, name);
    if (!deleted) throw new Error("That alert was not found.");
    await interaction.reply({ content: `Deleted **${escapeMarkdown(name)}**.`, flags: ephemeral });
    return;
  }
  if (subcommand === "pause" || subcommand === "resume") {
    const paused = subcommand === "pause";
    const subscription = await dependencies.repository.setSubscriptionPaused(
      guildId,
      userId,
      name,
      paused,
    );
    if (!subscription) throw new Error("That alert was not found.");
    await interaction.reply({
      content: paused
        ? `Paused **${escapeMarkdown(subscription.name)}**.`
        : `Resumed **${escapeMarkdown(subscription.name)}**. Future matches will be delivered privately.`,
      embeds: [subscriptionEmbed(subscription)],
      flags: ephemeral,
    });
    if (!paused) {
      void dependencies
        .notifyNow()
        .catch((error: unknown) => dependencies.logger.error({ error }, "Alert wake-up failed"));
    }
    return;
  }
  if (subcommand === "preview") {
    const subscription = await dependencies.repository.getUserSubscription(guildId, userId, name);
    if (!subscription) throw new Error("That alert was not found.");
    const matches = await dependencies.repository.searchSubscriptionMatches(subscription, 5);
    await interaction.reply({
      content:
        matches.length > 0
          ? `Current preview for **${escapeMarkdown(subscription.name)}**. These are not added to your delivery queue.`
          : `No currently open jobs match **${escapeMarkdown(subscription.name)}**.`,
      embeds: matches.map(jobEmbed),
      allowedMentions: { parse: [] },
      flags: ephemeral,
    });
  }
}

async function handleNotificationRoleSelection(
  interaction: StringSelectMenuInteraction,
  dependencies: HandlerDependencies,
): Promise<void> {
  if (!interaction.guildId || !interaction.guild) {
    throw new Error("Notification roles can only be managed in a server.");
  }
  const guild = interaction.guild;
  const botMember = guild.members.me;
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error("Stentor needs Manage Roles to update notification roles.");
  }
  const requested: NotificationCategory[] = interaction.values.includes(NOTIFICATION_ROLE_NONE)
    ? []
    : interaction.values.map((value) => {
        const parsed = parseNotificationCategoryKey(value);
        if (!parsed) throw new Error("That notification category is invalid.");
        return parsed;
      });
  const settings = await dependencies.repository.getGuildSettings(guild.id);
  if (!settings) throw new Error("An administrator must configure Stentor first.");
  const available = await dependencies.repository.listAvailableNotificationCategories(guild.id);
  const validKeys = new Set(
    available
      .filter(
        (category) =>
          (settings.programs.length === 0 || settings.programs.includes(category.program)) &&
          (settings.cycles.length === 0 || settings.cycles.includes(category.cycle)),
      )
      .map(notificationCategoryKey),
  );
  if (requested.some((category) => !validKeys.has(notificationCategoryKey(category)))) {
    throw new Error("One of those notification categories is no longer available.");
  }

  await interaction.deferUpdate();
  const member = await guild.members.fetch(interaction.user.id);
  const discordRoles = await guild.roles.fetch();
  const managed = await dependencies.repository.listNotificationRoles(guild.id);
  const mappings = new Map(managed.map((role) => [notificationCategoryKey(role), role]));
  const selectedRoleIds: string[] = [];
  for (const category of requested) {
    const key = notificationCategoryKey(category);
    let mapping = mappings.get(key);
    let role = mapping ? discordRoles.get(mapping.roleId) : null;
    if (!role) {
      role = await guild.roles.create({
        name: notificationRoleName(category),
        permissions: [],
        hoist: false,
        mentionable: false,
        reason: `Stentor notification role requested by ${interaction.user.id}`,
      });
      mapping = await dependencies.repository.saveNotificationRole(
        guild.id,
        category.program,
        category.cycle,
        role.id,
      );
      mappings.set(key, mapping);
    }
    selectedRoleIds.push(role.id);
  }
  const managedRoleIds = managed
    .map((role) => role.roleId)
    .filter((roleId) => discordRoles.has(roleId));
  const rolesToRemove = managedRoleIds.filter((roleId) => !selectedRoleIds.includes(roleId));
  if (selectedRoleIds.length > 0) {
    await member.roles.add(selectedRoleIds, "Member updated Stentor notification preferences");
  }
  if (rolesToRemove.length > 0) {
    await member.roles.remove(rolesToRemove, "Member updated Stentor notification preferences");
  }
  await dependencies.repository.replaceUserNotificationCategories(
    guild.id,
    interaction.user.id,
    requested,
  );
  await interaction.editReply({
    content:
      requested.length > 0
        ? `Saved ${requested.length} opt-in channel ping${requested.length === 1 ? "" : "s"}. Use \`/alerts roles\` any time to change them.`
        : "Channel pings are off. Your private DM alerts are unchanged.",
    components: [],
  });
}

async function handleAutocomplete(
  interaction: AutocompleteInteraction,
  repository: Repository,
): Promise<void> {
  if (interaction.commandName !== "alerts" || !interaction.guildId) return;
  const focused = interaction.options.getFocused().toLocaleLowerCase("en-US");
  const subscriptions = await repository.listUserSubscriptions(
    interaction.guildId,
    interaction.user.id,
  );
  await interaction.respond(
    subscriptions
      .filter((subscription) => subscription.nameKey.includes(focused))
      .slice(0, 25)
      .map((subscription) => ({ name: subscription.name, value: subscription.name })),
  );
}

async function handleCommand(
  interaction: ChatInputCommandInteraction,
  dependencies: HandlerDependencies,
  searchSessions: SearchSessions,
) {
  if (interaction.commandName === "stentor") return handleStentor(interaction, dependencies);
  if (interaction.commandName === "job-admin") return handleJobAdmin(interaction, dependencies);
  if (interaction.commandName === "alerts") return handleAlerts(interaction, dependencies);
  if (interaction.commandName === "jobs") {
    const guildId = requireGuild(interaction);
    const subcommand = interaction.options.getSubcommand();
    const filters: JobSearchFilters = {
      query: subcommand === "search" ? (interaction.options.getString("query") ?? "") : "",
      program: subcommand === "search" ? interaction.options.getString("program") : null,
      cycle: subcommand === "search" ? interaction.options.getString("cycle") : null,
      location: subcommand === "search" ? interaction.options.getString("location") : null,
      sponsorship: subcommand === "search" ? interaction.options.getString("sponsorship") : null,
      remoteOnly:
        subcommand === "search" ? (interaction.options.getBoolean("remote_only") ?? false) : false,
      requireLink:
        subcommand === "search" ? (interaction.options.getBoolean("require_link") ?? false) : false,
    };
    const token = searchSessions.create(interaction.user.id, guildId, filters);
    return renderSearch(interaction, dependencies.repository, guildId, filters, 0, token);
  }
}

async function handleButton(
  interaction: ButtonInteraction,
  repository: Repository,
  searchSessions: SearchSessions,
) {
  if (interaction.customId.startsWith("jobs:p:")) {
    if (!interaction.guildId) throw new Error("This control can only be used in a server.");
    const [, , token, rawOffset] = interaction.customId.split(":");
    if (!token) throw new Error("Invalid search control.");
    const offset = Number.parseInt(rawOffset ?? "0", 10);
    const filters = searchSessions.get(token, interaction.user.id, interaction.guildId);
    if (!filters) throw new Error("This search expired. Run `/jobs search` again.");
    await renderSearch(
      interaction,
      repository,
      interaction.guildId,
      filters,
      Number.isFinite(offset) ? offset : 0,
      token,
    );
    return;
  }
  if (interaction.customId.startsWith("board:")) {
    if (!interaction.guildId) throw new Error("This control can only be used in a server.");
    const [, action, rawProgram, rawOffset] = interaction.customId.split(":");
    if (action === "help") {
      if (rawProgram !== "alerts" && rawProgram !== "search") {
        throw new Error("Invalid live-board help control.");
      }
      await interaction.reply({
        allowedMentions: { parse: [] },
        components: [boardHelpContainer(rawProgram)],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      });
      return;
    }
    if (action !== "start" && action !== "page") throw new Error("Invalid live-board control.");
    if (!rawProgram || !["all", "internship", "new-grad", "experienced"].includes(rawProgram)) {
      throw new Error("Invalid live-board program.");
    }
    const parsedOffset = Number.parseInt(rawOffset ?? "0", 10);
    const offset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;
    await renderBoardBrowse(
      interaction,
      repository,
      interaction.guildId,
      rawProgram === "all" ? null : rawProgram,
      offset,
      action === "start",
    );
  }
}

export function createInteractionHandler(dependencies: HandlerDependencies) {
  const searchSessions = new SearchSessions();
  return async (interaction: Interaction): Promise<void> => {
    try {
      if (interaction.isAutocomplete())
        await handleAutocomplete(interaction, dependencies.repository);
      else if (interaction.isChatInputCommand()) {
        await handleCommand(interaction, dependencies, searchSessions);
      } else if (interaction.isButton()) {
        await handleButton(interaction, dependencies.repository, searchSessions);
      } else if (interaction.isStringSelectMenu() && interaction.customId === "alerts:roles") {
        await handleNotificationRoleSelection(interaction, dependencies);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      dependencies.logger.error(
        { error, interactionId: interaction.id, userId: interaction.user.id },
        "Interaction failed",
      );
      if (!interaction.isRepliable()) return;
      if (interaction.deferred || interaction.replied)
        await interaction.editReply({ content: `⚠️ ${message}` });
      else await interaction.reply({ content: `⚠️ ${message}`, flags: ephemeral });
    }
  };
}
