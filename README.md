# Stentor

<p align="center">
  <img src="assets/stentor-avatar.png" width="128" alt="Stentor herald mark">
</p>

Stentor is a Discord-native job board powered by [Keryx](https://github.com/GodlyDonuts/keryx). It maintains a live, interactive display of US internships and new-graduate roles, gives members a private search experience, and lets trusted server administrators publish and close community listings.

The name fits the job: Keryx is the herald that discovers opportunities; Stentor is the voice that carries them into a community.

## What it does

- Polls Keryx's canonical `data/jobs.json` with HTTP ETags every 15 minutes.
- Supports Keryx schemas v1 and v2, preserving provenance-aware academic eligibility metadata and its required/preferred/stated distinction.
- Creates a safe baseline on first boot instead of dumping the entire historical catalog into Discord.
- Maintains one pinned live-board message that updates in place instead of flooding a channel.
- Uses Discord Components V2 for a native dashboard with a branded container, compact job sections, inline Apply buttons, and private explorer pages.
- Offers an optional classic announcement feed for servers that prefer one message per job.
- Opens stateless, private pagination when a member uses the board's program buttons; one member never changes the public display for everyone else.
- Applies per-server program, cycle, keyword, location, sponsorship, remote, and link-availability filters to the board and its browsing controls.
- Recreates a deleted board automatically on the next refresh or restart.
- Persists every delivery and retries transient Discord failures with bounded exponential backoff.
- Provides `/jobs search` and `/jobs latest` as private, paginated results.
- Lets each member keep up to five private alerts with program, cycle, keyword, location, remote, sponsorship, and link filters.
- Delivers member alerts immediately or as timezone-aware daily digests, with automatic DM-failure pausing.
- Lets members with **Manage Server** publish direct application links with `/job-admin post`, auto-expire listings, and visibly close them.
- Preserves Keryx's link-confidence status rather than implying every discovered link has the same trust level.
- Exposes liveness, readiness, and Prometheus metrics without requiring a public dashboard.

Stentor requests only the Discord `Guilds` gateway intent. It does not read messages, resumes, applications, direct messages, or member lists.

## Commands

| Command                     | Who can use it | Purpose                                                                     |
| --------------------------- | -------------- | --------------------------------------------------------------------------- |
| `/stentor configure`        | Manage Server  | Select live-board or announcement mode, its channel, and filters            |
| `/stentor board`            | Manage Server  | Create, repair, or immediately refresh the persistent board                 |
| `/stentor status`           | Manage Server  | Show configuration and Keryx freshness                                      |
| `/stentor pause` / `resume` | Manage Server  | Stop delivery without losing pending jobs                                   |
| `/stentor sync`             | Manage Server  | Request an immediate conditional refresh                                    |
| `/jobs latest`              | Everyone       | Browse the newest open roles                                                |
| `/jobs search`              | Everyone       | Search with program, cycle, location, remote, sponsorship, and link filters |
| `/alerts create`            | Everyone       | Create or replace a private immediate alert or daily digest                 |
| `/alerts roles`             | Everyone       | Choose bot-managed program + cycle roles for opt-in channel pings           |
| `/alerts manage`            | Everyone       | Inspect private alerts and delivery problems                                |
| `/alerts preview`           | Everyone       | Preview matches without backfilling the delivery queue                      |
| `/alerts pause` / `resume`  | Everyone       | Control a personal alert                                                    |
| `/alerts delete`            | Everyone       | Delete an alert and its delivery history                                    |
| `/alerts forget-me`         | Everyone       | Erase all personal alert data                                               |
| `/job-admin post`           | Manage Server  | Publish a server-scoped community listing                                   |
| `/job-admin close`          | Manage Server  | Close an admin-authored listing and update its message                      |

Search results from admin-authored listings remain scoped to the server that created them. Keryx listings are shared globally.

### Personal alert semantics

Filters are **OR within a category** and **AND across categories**. An alert with cycles `fall-2026, summer-2027`, program `internship`, and locations `remote, New York` means: an internship in either selected cycle, in either selected location. Create separate named alerts for alternatives such as “summer internships OR 2027 new-grad roles.”

New alerts start at creation time and never dump historical matches into DMs. `/alerts preview` searches the current catalog without changing that baseline. Daily digests contain at most eight jobs per message and continue in bounded batches when a day has an unusually large number of matches.

`/alerts roles` is the broad, shared notification layer. Stentor creates roles only when a member requests them, keeps them non-hoisted and non-mentionable by humans, and pings only the exact program + cycle role for a newly eligible job. Role selection never backfills old jobs. Fine-grained filters remain private DM alerts so the server does not accumulate a role for every keyword or location combination.

## Architecture

```mermaid
flowchart LR
    K["Keryx jobs.json"] -->|"ETag poll"| S["Synchronizer"]
    A["Discord admin"] -->|"/job-admin post"| S
    S --> P[("PostgreSQL")]
    P --> Q["Durable refresh queue"]
    Q --> D["Pinned live board + opt-in role pings"]
    Q --> F["Optional announcement feed"]
    P --> N["Personal alert worker"]
    N --> M["Private member DMs"]
    U["Discord member"] -->|"/jobs search"| P
    H["Health and metrics"] --> P
    H --> D
```

PostgreSQL is the source of truth for jobs, guild settings, sync state, and idempotent Discord deliveries. No Supabase, Firebase, Redis, or hosted control plane is required for a single VPS deployment.

## Operations

- `GET /health/live` reports process liveness.
- `GET /health/ready` verifies PostgreSQL and the Discord gateway.
- `GET /metrics` exports Prometheus metrics.
- JSON logs go to stdout and redact authorization/token fields.
- Keryx failures never erase previously indexed jobs. A failed fetch increments health state and is retried at the next interval.
- Board and announcement failures retry up to ten times. A `(guild, job)` primary key prevents duplicate delivery across restarts, while one stored board message ID prevents duplicate public displays.
- The optional files under `deploy/` provide a one-minute host watchdog and daily seven-day local database backups for VPS deployments.

## Security model

Keryx performs the upstream URL verification and normalization. Stentor displays its link-confidence classification exactly. Admin-submitted links are separately constrained to public HTTPS destinations: credentials, IP literals, local hosts, nonstandard ports, fragments, tracking parameters, and common shorteners are rejected. Community listings are labeled as admin-submitted, not Keryx-verified.

Discord authorization is enforced both in command metadata and at runtime. Mentions are restricted to the one configured role, and member-generated text is escaped before rendering in embeds.

## License

MIT
