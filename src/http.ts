import Fastify, { LogController } from "fastify";
import type { Client } from "discord.js";
import type { Config } from "./config.js";
import type { Repository } from "./db/repository.js";
import type { Logger } from "./logger.js";
import type { Metrics } from "./metrics.js";

export function createHttpServer(
  config: Config,
  client: Client,
  repository: Repository,
  metrics: Metrics,
  logger: Logger,
) {
  const server = Fastify({
    loggerInstance: logger,
    logController: new LogController({ disableRequestLogging: true }),
  });

  server.get("/health/live", () => ({ status: "ok" }));
  server.get("/health/ready", async (_request, reply) => {
    try {
      await repository.ping();
      if (!client.isReady()) throw new Error("Discord gateway is not ready");
      metrics.ready.set(1);
      return { status: "ready", discord: client.user?.tag ?? null };
    } catch (error) {
      metrics.ready.set(0);
      return reply.code(503).send({
        status: "not_ready",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });
  server.get("/metrics", async (_request, reply) => {
    reply.header("content-type", metrics.registry.contentType);
    return metrics.registry.metrics();
  });

  return {
    server,
    listen: () => server.listen({ host: config.HTTP_HOST, port: config.HTTP_PORT }),
  };
}
