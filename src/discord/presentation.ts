import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  escapeMarkdown,
} from "discord.js";
import type { Job } from "../db/schema.js";
import type { Subscription } from "../db/schema.js";

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
