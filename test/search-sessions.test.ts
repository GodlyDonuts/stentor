import { describe, expect, it, vi } from "vitest";
import { SearchSessions } from "../src/discord/search-sessions.js";
import { emptySearchFilters } from "../src/domain/search.js";

describe("SearchSessions", () => {
  it("binds pagination state to the requesting member and server", () => {
    const sessions = new SearchSessions();
    const token = sessions.create("user-1", "guild-1", emptySearchFilters);
    expect(sessions.get(token, "user-1", "guild-1")).toEqual(emptySearchFilters);
    expect(sessions.get(token, "user-2", "guild-1")).toBeNull();
    expect(sessions.get(token, "user-1", "guild-2")).toBeNull();
  });

  it("expires abandoned pagination state", () => {
    vi.useFakeTimers();
    const sessions = new SearchSessions(1_000);
    const token = sessions.create("user-1", "guild-1", emptySearchFilters);
    vi.advanceTimersByTime(1_001);
    expect(sessions.get(token, "user-1", "guild-1")).toBeNull();
    vi.useRealTimers();
  });
});
