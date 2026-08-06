import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

const programChoices = [
  { name: "All early-career roles", value: "all" },
  { name: "Internships", value: "internship" },
  { name: "New graduate", value: "new-grad" },
] as const;

export const commands = [
  new SlashCommandBuilder()
    .setName("stentor")
    .setDescription("Configure the Stentor job feed")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("configure")
        .setDescription("Choose the live-board channel and filters")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Channel that will contain the Stentor job display")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("display")
            .setDescription("How the official channel should present jobs")
            .addChoices(
              { name: "Live board — one interactive message (recommended)", value: "board" },
              { name: "Announcement feed — one message per job", value: "announcements" },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("program")
            .setDescription("Which programs should be announced")
            .addChoices(...programChoices),
        )
        .addRoleOption((option) =>
          option.setName("ping_role").setDescription("Optional role to mention for each new job"),
        )
        .addStringOption((option) =>
          option.setName("cycles").setDescription("Comma-separated cycles, e.g. summer-2027, 2027"),
        )
        .addStringOption((option) =>
          option.setName("keywords").setDescription("Only titles/companies containing these terms"),
        )
        .addStringOption((option) =>
          option.setName("locations").setDescription("Only locations containing these terms"),
        )
        .addStringOption((option) =>
          option
            .setName("sponsorship")
            .setDescription("Sponsorship preference")
            .addChoices(
              { name: "Any or unstated", value: "any" },
              { name: "Offers sponsorship", value: "offers" },
              { name: "No sponsorship / citizenship required", value: "no-sponsorship" },
            ),
        )
        .addBooleanOption((option) =>
          option
            .setName("remote_only")
            .setDescription("Only announce roles explicitly marked remote"),
        )
        .addBooleanOption((option) =>
          option
            .setName("require_link")
            .setDescription("Skip Keryx roles without a verified application URL"),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("Show this server's configuration and feed health"),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("pause").setDescription("Pause new job announcements"),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("resume").setDescription("Resume new job announcements"),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("sync").setDescription("Request an immediate Keryx refresh"),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("board").setDescription("Create, repair, or refresh the live job board"),
    ),
  new SlashCommandBuilder()
    .setName("jobs")
    .setDescription("Find open roles")
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("search")
        .setDescription("Search open Keryx and community roles")
        .addStringOption((option) =>
          option.setName("query").setDescription("Company, title, or location").setMaxLength(80),
        )
        .addStringOption((option) =>
          option
            .setName("program")
            .setDescription("Limit to a program")
            .addChoices(
              { name: "Internships", value: "internship" },
              { name: "New graduate", value: "new-grad" },
              { name: "Experienced", value: "experienced" },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("cycle")
            .setDescription("Recruiting cycle, e.g. summer-2027")
            .setMaxLength(50),
        )
        .addStringOption((option) =>
          option
            .setName("location")
            .setDescription("Location or remote-policy term")
            .setMaxLength(80),
        )
        .addStringOption((option) =>
          option
            .setName("sponsorship")
            .setDescription("Sponsorship preference")
            .addChoices(
              { name: "Offers sponsorship", value: "offers" },
              { name: "No sponsorship / citizenship required", value: "no-sponsorship" },
            ),
        )
        .addBooleanOption((option) =>
          option.setName("remote_only").setDescription("Only roles explicitly marked remote"),
        )
        .addBooleanOption((option) =>
          option.setName("require_link").setDescription("Only roles with an application link"),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("latest").setDescription("Browse the latest open roles"),
    ),
  new SlashCommandBuilder()
    .setName("job-admin")
    .setDescription("Publish and manage community job listings")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("post")
        .setDescription("Publish a job to this server's configured channel")
        .addStringOption((option) =>
          option
            .setName("company")
            .setDescription("Employer name")
            .setMaxLength(100)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option.setName("title").setDescription("Role title").setMaxLength(150).setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("location")
            .setDescription("Location or remote policy")
            .setMaxLength(150)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option.setName("url").setDescription("Direct HTTPS application URL").setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("program")
            .setDescription("Career level")
            .setRequired(true)
            .addChoices(
              { name: "Internship", value: "internship" },
              { name: "New graduate", value: "new-grad" },
              { name: "Experienced", value: "experienced" },
            ),
        )
        .addStringOption((option) =>
          option.setName("description").setDescription("Short role summary").setMaxLength(1_000),
        )
        .addStringOption((option) =>
          option
            .setName("cycle")
            .setDescription("Recruiting cycle, e.g. summer-2027")
            .setMaxLength(50),
        )
        .addIntegerOption((option) =>
          option
            .setName("expires_in_days")
            .setDescription("Automatically close after this many days")
            .setMinValue(1)
            .setMaxValue(365),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("close")
        .setDescription("Close an admin-authored listing")
        .addStringOption((option) =>
          option
            .setName("job_id")
            .setDescription("ID shown in the listing footer")
            .setRequired(true),
        ),
    ),
  new SlashCommandBuilder()
    .setName("alerts")
    .setDescription("Create and manage personal job alerts")
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("create")
        .setDescription("Create or replace a private job alert")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("A short name, e.g. fall-internships")
            .setMinLength(1)
            .setMaxLength(32)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("program")
            .setDescription("Career level")
            .addChoices(
              { name: "All roles", value: "all" },
              { name: "Internships", value: "internship" },
              { name: "New graduate", value: "new-grad" },
              { name: "Experienced community roles", value: "experienced" },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("cycles")
            .setDescription("Comma-separated cycles, e.g. fall-2026, summer-2027"),
        )
        .addStringOption((option) =>
          option.setName("keywords").setDescription("Comma-separated title or company terms"),
        )
        .addStringOption((option) =>
          option.setName("locations").setDescription("Comma-separated location terms"),
        )
        .addStringOption((option) =>
          option
            .setName("sponsorship")
            .setDescription("Sponsorship preference")
            .addChoices(
              { name: "Any or unstated", value: "any" },
              { name: "Offers sponsorship", value: "offers" },
              { name: "No sponsorship / citizenship required", value: "no-sponsorship" },
            ),
        )
        .addBooleanOption((option) =>
          option.setName("remote_only").setDescription("Only roles explicitly marked remote"),
        )
        .addBooleanOption((option) =>
          option
            .setName("require_link")
            .setDescription("Only roles with a safe application link (recommended)"),
        )
        .addStringOption((option) =>
          option
            .setName("delivery")
            .setDescription("How often to receive private alerts")
            .addChoices(
              { name: "Daily digest (recommended)", value: "daily" },
              { name: "Immediate", value: "immediate" },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("timezone")
            .setDescription("Timezone for daily delivery")
            .addChoices(
              { name: "US Eastern", value: "America/New_York" },
              { name: "US Central", value: "America/Chicago" },
              { name: "US Mountain", value: "America/Denver" },
              { name: "US Pacific", value: "America/Los_Angeles" },
              { name: "Arizona", value: "America/Phoenix" },
              { name: "Alaska", value: "America/Anchorage" },
              { name: "Hawaii", value: "Pacific/Honolulu" },
              { name: "UTC", value: "UTC" },
            ),
        )
        .addIntegerOption((option) =>
          option
            .setName("digest_hour")
            .setDescription("Local delivery hour, 0–23 (default: 9)")
            .setMinValue(0)
            .setMaxValue(23),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("manage").setDescription("Show your saved alerts and delivery status"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("preview")
        .setDescription("Privately preview current matches for an alert")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Saved alert name")
            .setAutocomplete(true)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("pause")
        .setDescription("Pause a saved alert")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Saved alert name")
            .setAutocomplete(true)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("resume")
        .setDescription("Resume a saved alert")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Saved alert name")
            .setAutocomplete(true)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("delete")
        .setDescription("Delete a saved alert and its delivery history")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Saved alert name")
            .setAutocomplete(true)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("forget-me")
        .setDescription("Delete all of your personal alert data")
        .addBooleanOption((option) =>
          option.setName("confirm").setDescription("Confirm permanent deletion").setRequired(true),
        ),
    ),
].map((command) => command.toJSON());
