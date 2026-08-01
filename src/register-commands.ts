import { REST, Routes } from "discord.js";
import { loadConfig, loadLocalEnv } from "./config.js";
import { commands } from "./discord/commands.js";

loadLocalEnv();
const config = loadConfig();
const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
const route = config.DISCORD_DEV_GUILD_ID
  ? Routes.applicationGuildCommands(config.DISCORD_APPLICATION_ID, config.DISCORD_DEV_GUILD_ID)
  : Routes.applicationCommands(config.DISCORD_APPLICATION_ID);

await rest.put(route, { body: commands });
process.stdout.write(
  `Registered ${commands.length} commands ${config.DISCORD_DEV_GUILD_ID ? "in the development server" : "globally"}.\n`,
);
