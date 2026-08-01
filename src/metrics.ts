import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: "stentor_" });
  const syncs = new Counter({
    name: "stentor_keryx_sync_total",
    help: "Keryx synchronization attempts",
    labelNames: ["result"] as const,
    registers: [registry],
  });
  const syncDuration = new Histogram({
    name: "stentor_keryx_sync_duration_seconds",
    help: "Keryx synchronization duration",
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    registers: [registry],
  });
  const announcements = new Counter({
    name: "stentor_announcements_total",
    help: "Discord announcement attempts",
    labelNames: ["result"] as const,
    registers: [registry],
  });
  const ready = new Gauge({
    name: "stentor_ready",
    help: "Whether Discord and PostgreSQL are ready",
    registers: [registry],
  });
  const subscriptionNotifications = new Counter({
    name: "stentor_subscription_notifications_total",
    help: "Personal subscription notification attempts",
    labelNames: ["mode", "result"] as const,
    registers: [registry],
  });
  const subscriptionQueue = new Gauge({
    name: "stentor_subscription_queue_depth",
    help: "Personal deliveries handled by the latest worker pass",
    registers: [registry],
  });
  return {
    registry,
    syncs,
    syncDuration,
    announcements,
    subscriptionNotifications,
    subscriptionQueue,
    ready,
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
