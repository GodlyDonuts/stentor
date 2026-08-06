import { ChannelType, ComponentType, MessageFlags } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import type { Repository } from "../src/db/repository.js";
import type { GuildSettings, Job } from "../src/db/schema.js";
import {
  boardBrowseNavigation,
  jobBoardContainer,
  jobBoardControls,
  jobBrowserContainer,
} from "../src/discord/presentation.js";
import { createLogger } from "../src/logger.js";
import { createMetrics } from "../src/metrics.js";
import { Announcer } from "../src/services/announcer.js";
import { JobBoardPublisher } from "../src/services/job-board.js";

const settings = {
  guildId: "guild-1",
  channelId: "channel-1",
  pingRoleId: null,
  deliveryMode: "board",
  boardMessageId: null,
  boardUpdatedAt: null,
  programs: ["internship"],
  cycles: ["fall-2026", "summer-2027"],
  keywords: [],
  locations: [],
  sponsorship: "any",
  requireLink: true,
  remoteOnly: false,
  paused: false,
  configuredBy: "admin-1",
  createdAt: new Date("2026-08-01T00:00:00Z"),
  updatedAt: new Date("2026-08-01T00:00:00Z"),
} as GuildSettings;

const job = {
  id: "job-1",
  source: "keryx",
  ownerGuildId: null,
  postedBy: null,
  company: "Acme",
  title: "Software Engineering Intern",
  location: "New York, NY",
  description: null,
  url: "https://example.com/apply",
  urlHost: "example.com",
  linkStatus: "cross-source",
  program: "internship",
  cycle: "summer-2027",
  sponsorship: null,
  status: "open",
  firstSeen: new Date("2026-08-06T00:00:00Z"),
  postedAt: null,
  closesAt: null,
  closedAt: null,
  raw: {},
  createdAt: new Date("2026-08-06T00:00:00Z"),
  updatedAt: new Date("2026-08-06T00:00:00Z"),
} as Job;

describe("live job board presentation", () => {
  it("renders a branded Components V2 dashboard within Discord's component limit", () => {
    const container = jobBoardContainer(settings, Array<Job>(6).fill(job)).toJSON();
    const controls = jobBoardControls(settings)?.toJSON();
    const navigation = boardBrowseNavigation("internship", 5, true).toJSON();
    const browser = jobBrowserContainer(settings, [job], "internship", 0, false).toJSON();
    const countComponents = (component: unknown): number => {
      if (!component || typeof component !== "object") return 0;
      const children =
        "components" in component && Array.isArray(component.components)
          ? component.components
          : [];
      const accessory = "accessory" in component ? component.accessory : null;
      return (
        1 +
        children.reduce<number>((total, child) => total + countComponents(child), 0) +
        (accessory ? countComponents(accessory) : 0)
      );
    };

    expect(container.type).toBe(ComponentType.Container);
    expect(container.accent_color).toBe(0x7c5cff);
    expect(JSON.stringify(container)).toContain("🟢 **LIVE**");
    expect(JSON.stringify(container)).toContain("https://example.com/apply");
    expect(countComponents(container)).toBeLessThanOrEqual(40);
    expect(JSON.stringify(browser)).toContain("Private explorer");
    expect(
      controls?.components[0] && "custom_id" in controls.components[0]
        ? controls.components[0].custom_id
        : null,
    ).toBe("board:start:internship:0");
    expect(
      controls?.components.map((component) =>
        "custom_id" in component ? component.custom_id : null,
      ),
    ).toEqual(["board:start:internship:0", "board:help:alerts:0", "board:help:search:0"]);
    expect(
      navigation.components.map((component) =>
        "custom_id" in component ? component.custom_id : null,
      ),
    ).toEqual(["board:page:internship:0", "board:page:internship:10"]);
  });
});

describe("JobBoardPublisher", () => {
  it("creates, pins, and persists one board message", async () => {
    const pin = vi.fn().mockResolvedValue(undefined);
    const message = { id: "message-1", pinned: false, pinnable: true, pin };
    const send = vi.fn().mockResolvedValue(message);
    const setGuildBoardMessage = vi.fn().mockResolvedValue(undefined);
    const repository = {
      searchGuildBoardJobs: vi.fn().mockResolvedValue([job]),
      setGuildBoardMessage,
    } as unknown as Repository;
    const client = {
      channels: {
        fetch: vi.fn().mockResolvedValue({
          type: ChannelType.GuildText,
          isTextBased: () => true,
          send,
          messages: { fetch: vi.fn() },
        }),
      },
    };
    const publisher = new JobBoardPublisher(
      client as never,
      repository,
      createLogger({ LOG_LEVEL: "silent", NODE_ENV: "test" }),
    );

    await expect(
      Promise.all([publisher.refresh(settings), publisher.refresh(settings)]),
    ).resolves.toEqual(["message-1", "message-1"]);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
      }),
    );
    expect(pin).toHaveBeenCalledWith("Stentor live job board");
    expect(setGuildBoardMessage).toHaveBeenCalledWith("guild-1", "message-1");
  });
});

describe("Announcer live-board batching", () => {
  it("collapses multiple queued jobs into one board refresh", async () => {
    const queued = [job, { ...job, id: "job-2" } as Job].map((queuedJob) => ({
      job: queuedJob,
      settings,
      announcement: {
        guildId: settings.guildId,
        channelId: settings.channelId,
        jobId: queuedJob.id,
        messageId: null,
        action: "post",
        state: "pending",
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: null,
        createdAt: new Date(),
        sentAt: null,
      },
    }));
    const markAnnouncementSent = vi.fn().mockResolvedValue(undefined);
    const markAnnouncementFailed = vi.fn().mockResolvedValue(undefined);
    const repository = {
      listPendingAnnouncements: vi.fn().mockResolvedValue(queued),
      markAnnouncementSent,
      markAnnouncementFailed,
    } as unknown as Repository;
    const board = { refresh: vi.fn().mockResolvedValue("board-message") };
    const announcer = new Announcer(
      { isReady: () => true } as never,
      repository,
      createLogger({ LOG_LEVEL: "silent", NODE_ENV: "test" }),
      createMetrics(),
      5_000,
      board as never,
    );

    await announcer.run();

    expect(board.refresh).toHaveBeenCalledOnce();
    expect(markAnnouncementSent).toHaveBeenCalledTimes(2);
    expect(markAnnouncementSent).toHaveBeenCalledWith("guild-1", "job-1", "board-message");
    expect(markAnnouncementSent).toHaveBeenCalledWith("guild-1", "job-2", "board-message");
  });
});
