import { randomBytes } from "node:crypto";
import type { JobSearchFilters } from "../domain/search.js";

interface SearchSession {
  userId: string;
  guildId: string;
  filters: JobSearchFilters;
  expiresAt: number;
}

export class SearchSessions {
  private readonly sessions = new Map<string, SearchSession>();

  public constructor(
    private readonly ttlMs = 15 * 60_000,
    private readonly capacity = 1_000,
  ) {}

  create(userId: string, guildId: string, filters: JobSearchFilters): string {
    this.prune();
    while (this.sessions.size >= this.capacity) {
      const oldest = this.sessions.keys().next().value;
      if (!oldest) break;
      this.sessions.delete(oldest);
    }
    const token = randomBytes(9).toString("base64url");
    this.sessions.set(token, { userId, guildId, filters, expiresAt: Date.now() + this.ttlMs });
    return token;
  }

  get(token: string, userId: string, guildId: string): JobSearchFilters | null {
    const session = this.sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    if (session.userId !== userId || session.guildId !== guildId) return null;
    return session.filters;
  }

  private prune(): void {
    const now = Date.now();
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(token);
    }
  }
}
