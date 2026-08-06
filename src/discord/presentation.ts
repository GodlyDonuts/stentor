import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  escapeMarkdown,
} from "discord.js";
import type { Job } from "../db/schema.js";
import type { GuildSettings, Subscription } from "../db/schema.js";

const COLORS = { internship: 0x6c63ff, "new-grad": 0x16a085, experienced: 0xd4a017 } as const;
const LINK_LABELS: Record<string, string> = {
  "ats-verified": "Direct ATS verified",
  "cross-source": "Cross-checked",
  "platform-structured": "Recognized recruiting platform",
  unverified: "Unverified by Keryx",
  "admin-submitted": "Community admin",
};

function trim(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

export function formatProgram(program: string): string {
  if (program === "new-grad") return "New graduate";
  return program.charAt(0).toUpperCase() + program.slice(1);
}

export function jobEmbed(job: Job): EmbedBuilder {
  const closed = job.status === "closed";
  const embed = new EmbedBuilder()
    .setColor(closed ? 0x6b7280 : (COLORS[job.program as keyof typeof COLORS] ?? 0x6c63ff))
    .setAuthor({
      name: closed
        ? "Listing closed"
        : job.source === "keryx"
          ? "Keryx verified feed"
          : "Community listing",
    })
    .setTitle(trim(`${closed ? "[Closed] " : ""}${job.company} — ${job.title}`, 256))
    .addFields(
      { name: "Location", value: trim(job.location, 1_024), inline: true },
      { name: "Program", value: formatProgram(job.program), inline: true },
      { name: "Cycle", value: job.cycle, inline: true },
      {
        name: "Link confidence",
        value: LINK_LABELS[job.linkStatus] ?? job.linkStatus,
        inline: true,
      },
    )
    .setFooter({ text: `Job ID: ${job.id}` })
    .setTimestamp(job.postedAt ?? job.firstSeen);
  if (job.url) embed.setURL(job.url);
  if (job.description) embed.setDescription(trim(escapeMarkdown(job.description), 3_500));
  if (job.sponsorship)
    embed.addFields({ name: "Sponsorship", value: trim(job.sponsorship, 1_024), inline: true });
  return embed;
}

export function applicationButton(job: Job): ActionRowBuilder<ButtonBuilder> | null {
  if (!job.url) return null;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("View application")
      .setEmoji("↗️")
      .setStyle(ButtonStyle.Link)
      .setURL(job.url),
  );
}

export function searchNavigation(
  token: string,
  offset: number,
  hasNext: boolean,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`jobs:p:${token}:${Math.max(0, offset - 5)}`)
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(offset === 0),
    new ButtonBuilder()
      .setCustomId(`jobs:p:${token}:${offset + 5}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!hasNext),
  );
}

function boardProgramLabel(program: string | null): string {
  if (program === "internship") return "Internships";
  if (program === "new-grad") return "New graduate";
  if (program === "experienced") return "Experienced";
  return "All roles";
}

function titleCaseCycle(cycle: string): string {
  return cycle
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function boardScope(settings: GuildSettings): string {
  const programs =
    settings.programs.length > 0 ? settings.programs.map(formatProgram).join(" + ") : "All roles";
  const cycles =
    settings.cycles.length === 0
      ? "All cycles"
      : settings.cycles.length === 1
        ? titleCaseCycle(settings.cycles[0]!)
        : `${titleCaseCycle(settings.cycles[0]!)} → ${titleCaseCycle(settings.cycles.at(-1)!)}`;
  return `${programs} · ${cycles}${settings.requireLink ? " · Verified links" : ""}`;
}

function compactConfidence(job: Job): string {
  if (job.linkStatus === "ats-verified") return "ATS verified";
  if (job.linkStatus === "cross-source") return "Cross-checked";
  if (job.linkStatus === "platform-structured") return "Recruiting platform";
  if (job.linkStatus === "admin-submitted") return "Admin-posted";
  return "Link pending verification";
}

function boardJobText(job: Job, rank?: number): string {
  const company = escapeMarkdown(trim(job.company, 80));
  const title = escapeMarkdown(trim(job.title, 120));
  const location = escapeMarkdown(trim(job.location, 100));
  const prefix = rank ? `${String(rank).padStart(2, "0")} · ` : "";
  return `### ${prefix}${company}\n**${title}**\n📍 ${location}\n\`${titleCaseCycle(job.cycle).toUpperCase()}\`  \`${formatProgram(job.program).toUpperCase()}\`\n-# ${compactConfidence(job)} · Added <t:${Math.floor(job.firstSeen.getTime() / 1_000)}:R>`;
}

function addJobCard(container: ContainerBuilder, job: Job, rank?: number): void {
  if (job.url) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(boardJobText(job, rank)))
        .setButtonAccessory(
          new ButtonBuilder()
            .setLabel("Apply")
            .setEmoji("↗️")
            .setStyle(ButtonStyle.Link)
            .setURL(job.url),
        ),
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${boardJobText(job, rank)}\n-# Application link unavailable`,
      ),
    );
  }
}

function addJobCards(container: ContainerBuilder, jobs: Job[], ranked: boolean): void {
  jobs.forEach((job, index) => {
    addJobCard(container, job, ranked ? index + 1 : undefined);
    if (index < jobs.length - 1) {
      container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
      );
    }
  });
}

export function jobBoardContainer(
  settings: GuildSettings,
  boardJobs: Job[],
  brandIconUrl?: string,
): ContainerBuilder {
  const updated = Math.floor(Date.now() / 1_000);
  const header = `# STENTOR\n### Opportunity radar\n🟢 **LIVE** · **${escapeMarkdown(boardScope(settings))}**\n-# Curated from Keryx · Refreshed <t:${updated}:R>`;
  const container = new ContainerBuilder().setAccentColor(0x7c5cff);
  if (brandIconUrl) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
        .setThumbnailAccessory((thumbnail) =>
          thumbnail.setURL(brandIconUrl).setDescription("Stentor live job board"),
        ),
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header));
  }
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large),
  );
  if (boardJobs.length > 0) {
    addJobCards(container, boardJobs, true);
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## The radar is clear\nNo open roles match this board yet. Stentor will refresh automatically when one appears.",
      ),
    );
  }
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large),
  );
  const controls = jobBoardControls(settings);
  if (controls) container.addActionRowComponents(controls);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# Showing ${boardJobs.length} newest match${boardJobs.length === 1 ? "" : "es"} · Browsing opens privately · No channel spam`,
    ),
  );
  return container;
}

export function jobBoardControls(settings: GuildSettings): ActionRowBuilder<ButtonBuilder> | null {
  const available =
    settings.programs.length > 0 ? settings.programs : ["internship", "new-grad", "all"];
  const programs = [...new Set(available)].slice(0, 3);
  if (programs.length === 0) return null;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...programs.map((program) =>
      new ButtonBuilder()
        .setCustomId(`board:start:${program}:0`)
        .setLabel(program === "all" ? "All roles" : boardProgramLabel(program))
        .setEmoji(program === "internship" ? "🧭" : "🔎")
        .setStyle(program === "internship" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ),
    new ButtonBuilder()
      .setCustomId("board:help:alerts:0")
      .setLabel("Private alerts")
      .setEmoji("🔔")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("board:help:search:0")
      .setLabel("Advanced search")
      .setEmoji("⚙️")
      .setStyle(ButtonStyle.Secondary),
  );
}

export function boardBrowseNavigation(
  program: string | null,
  offset: number,
  hasNext: boolean,
): ActionRowBuilder<ButtonBuilder> {
  const key = program ?? "all";
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`board:page:${key}:${Math.max(0, offset - 5)}`)
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(offset === 0),
    new ButtonBuilder()
      .setCustomId(`board:page:${key}:${offset + 5}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!hasNext),
  );
}

export function jobBrowserContainer(
  settings: GuildSettings,
  browserJobs: Job[],
  program: string | null,
  offset: number,
  hasNext: boolean,
): ContainerBuilder {
  const label = boardProgramLabel(program);
  const container = new ContainerBuilder()
    .setAccentColor(program === "new-grad" ? 0x16a085 : 0x7c5cff)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${label}\n**Private explorer** · ${escapeMarkdown(boardScope(settings))}\n-# Showing ${browserJobs.length > 0 ? `${offset + 1}–${offset + browserJobs.length}` : "no matches"}`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large),
    );
  if (browserJobs.length > 0) addJobCards(container, browserJobs, false);
  else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## No matching roles\nTry another board view or `/jobs search` with broader filters.",
      ),
    );
  }
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large),
  );
  if (browserJobs.length > 0) {
    container.addActionRowComponents(boardBrowseNavigation(program, offset, hasNext));
  }
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "-# Only you can see this explorer · Results stay current across restarts",
    ),
  );
  return container;
}

export function boardHelpContainer(kind: "alerts" | "search"): ContainerBuilder {
  const isAlerts = kind === "alerts";
  return new ContainerBuilder()
    .setAccentColor(isAlerts ? 0xf0b232 : 0x7c5cff)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        isAlerts
          ? "# 🔔 Private job alerts\nCreate up to five personal alerts with `/alerts create`. Choose immediate delivery or a daily digest, then manage them with `/alerts manage`.\n\n-# Alerts are private and never change the public board."
          : "# ⚙️ Advanced search\nRun `/jobs search` to filter by company, title, cycle, location, remote work, sponsorship, or application-link availability.\n\n-# Search results are private and paginated.",
      ),
    );
}

export function digestEmbed(subscription: Subscription, digestJobs: Job[]): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x6c63ff)
    .setTitle(
      `${subscription.name} · ${digestJobs.length} new match${digestJobs.length === 1 ? "" : "es"}`,
    )
    .setDescription(
      "Your personal Stentor alert. Application links retain Keryx's safety classification.",
    )
    .setFooter({ text: "Manage with /alerts manage · Results are private" })
    .setTimestamp();
  for (const job of digestJobs) {
    const title = trim(`${job.company} — ${job.title}`, 200);
    const linkedTitle = job.url ? `[${escapeMarkdown(title)}](${job.url})` : escapeMarkdown(title);
    embed.addFields({
      name: linkedTitle,
      value: trim(
        `${escapeMarkdown(job.location)} · ${formatProgram(job.program)} · ${escapeMarkdown(job.cycle)}`,
        1_024,
      ),
    });
  }
  return embed;
}

export function subscriptionEmbed(subscription: Subscription): EmbedBuilder {
  const list = (values: string[], fallback: string) =>
    values.length > 0 ? values.join(", ") : fallback;
  const delivery =
    subscription.deliveryMode === "immediate"
      ? "Immediate private alerts"
      : `Daily at ${String(subscription.digestHour).padStart(2, "0")}:00 (${subscription.timezone})`;
  const status = subscription.paused ? "⏸️ Paused" : "✅ Active";
  const embed = new EmbedBuilder()
    .setColor(subscription.paused ? 0xf59e0b : 0x6c63ff)
    .setTitle(subscription.name)
    .setDescription(`${status} · ${delivery}`)
    .addFields(
      { name: "Programs", value: list(subscription.programs, "All"), inline: true },
      { name: "Cycles", value: list(subscription.cycles, "All"), inline: true },
      { name: "Locations", value: list(subscription.locations, "Any"), inline: true },
      { name: "Keywords", value: list(subscription.keywords, "Any"), inline: true },
      {
        name: "Options",
        value: [
          subscription.requireLink ? "Application link required" : "Link optional",
          subscription.remoteOnly ? "Remote only" : "Any work arrangement",
          subscription.sponsorship === "any" ? "Any sponsorship status" : subscription.sponsorship,
        ].join(" · "),
      },
    )
    .setFooter({ text: "Only you can view and manage this alert" })
    .setTimestamp(subscription.updatedAt);
  if (subscription.lastError) {
    embed.addFields({ name: "Delivery issue", value: trim(subscription.lastError, 1_024) });
  }
  return embed;
}
