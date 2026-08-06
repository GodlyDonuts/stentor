import { Client, Events, GatewayIntentBits } from "discord.js";
import { loadConfig, loadLocalEnv } from "./config.js";
import { createDatabase } from "./db/client.js";
import { Repository } from "./db/repository.js";
import { createInteractionHandler } from "./discord/handler.js";
import { createHttpServer } from "./http.js";
import { createLogger } from "./logger.js";
import { createMetrics } from "./metrics.js";
import { Announcer } from "./services/announcer.js";
import { KeryxClient } from "./services/keryx-client.js";
import { JobBoardPublisher } from "./services/job-board.js";
import { Synchronizer } from "./services/synchronizer.js";
import { SubscriptionMatcher, SubscriptionNotifier } from "./services/subscriptions.js";

loadLocalEnv();
const config = loadConfig();
const logger = createLogger(config);
const metrics = createMetrics();
const { db, pool } = createDatabase(config.DATABASE_URL, logger, config.DB_POOL_MAX);
const repository = new Repository(db);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const jobBoard = new JobBoardPublisher(client, repository, logger);
const subscriptionMatcher = new SubscriptionMatcher(repository);
const synchronizer = new Synchronizer(
  new KeryxClient(config.KERYX_URL),
  repository,
  logger,
  metrics,
  config.KERYX_POLL_SECONDS * 1_000,
  subscriptionMatcher,
  config.DELIVERY_RETENTION_DAYS,
);
const announcer = new Announcer(
  client,
  repository,
  logger,
  metrics,
  config.ANNOUNCEMENT_POLL_SECONDS * 1_000,
  jobBoard,
);
const subscriptionNotifier = new SubscriptionNotifier(
  client,
  repository,
  logger,
  metrics,
  config.SUBSCRIPTION_POLL_SECONDS * 1_000,
);
const http = createHttpServer(config, client, repository, metrics, logger);

client.on(
  Events.InteractionCreate,
  createInteractionHandler({
    client,
    repository,
    logger,
    syncNow: () => synchronizer.run(),
    announceNow: () => announcer.run(),
    notifyNow: () => subscriptionNotifier.run(),
    enqueuePersonalMatches: (jobs) => subscriptionMatcher.enqueue(jobs),
    refreshBoard: (settings) => jobBoard.refresh(settings),
  }),
);
client.on(Events.Error, (error) => logger.error({ error }, "Discord client error"));
client.on(Events.Warn, (message) => logger.warn({ message }, "Discord client warning"));
client.once(Events.ClientReady, (readyClient) => {
  logger.info(
    { bot: readyClient.user.tag, guilds: readyClient.guilds.cache.size },
    "Discord client ready",
  );
  synchronizer.start();
  announcer.start();
  subscriptionNotifier.start();
  void jobBoard.refreshAll();
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Graceful shutdown started");
  const forcedExit = setTimeout(() => {
    logger.fatal({ signal }, "Graceful shutdown timed out");
    process.exit(1);
  }, 25_000);
  forcedExit.unref();
  synchronizer.stop();
  announcer.stop();
  subscriptionNotifier.stop();
  metrics.ready.set(0);
  try {
    await Promise.allSettled([http.server.close(), client.destroy(), pool.end()]);
  } finally {
    clearTimeout(forcedExit);
  }
}

process.once("SIGINT", () => void shutdown("SIGINT").then(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown("SIGTERM").then(() => process.exit(0)));
process.on("unhandledRejection", (error) => {
  logger.fatal({ error }, "Unhandled promise rejection");
  void shutdown("unhandledRejection").then(() => process.exit(1));
});
process.on("uncaughtException", (error) => {
  logger.fatal({ error }, "Uncaught exception");
  void shutdown("uncaughtException").then(() => process.exit(1));
});

await repository.ping();
await Promise.all([http.listen(), client.login(config.DISCORD_TOKEN)]);
logger.info({ host: config.HTTP_HOST, port: config.HTTP_PORT }, "Stentor started");
