# Stentor architecture and operating invariants

## Product boundaries

Stentor is a job-discovery and delivery system. It does not accept applications, collect resumes, read server messages, rank people, or make employment decisions. Keryx remains the authoritative automated source; community jobs are explicitly labeled and scoped to the server that created them.

## Delivery model

There are three durable delivery stages in PostgreSQL:

1. Keryx inserts and filter-relevant updates create a transactional fan-out event. An event is acknowledged only after public and personal queue writes succeed, so a process crash cannot lose a newly eligible job.
2. Public refreshes are unique by `(guild, job)`. Live-board mode collapses any number of queued jobs into one edit of a stored, pinned message; classic announcement mode retains one message per job. Closures refresh the board or update the original announcement.
3. Personal deliveries are unique by `(subscription, job)`. A subscription can send immediate private batches or timezone-aware daily digests.

The delivery queues use bounded retry schedules and terminal states. A first Keryx synchronization creates a baseline and never generates fan-out events. Existing jobs are reconsidered only when a field that can change filter eligibility changes—for example, when Keryx promotes a withheld URL to a corroborated application link. New subscription creation also starts from “now”; preview is a read-only catalog query.

Filter values are normalized at the command boundary. Values within one category are alternatives; categories combine conjunctively. Community jobs only match subscriptions from their owning guild.

## Live-board interaction model

The public channel contains one compact embed with the eight newest jobs matching the administrator's filters. New jobs and closures edit that message in place. Its buttons create ephemeral five-job pages scoped to the same server filters, so browsing is private and cannot mutate the shared display. Button state is encoded in the custom ID rather than process memory, allowing pagination to survive restarts. On startup Stentor verifies every active board and recreates a board whose message was deleted.

## Privacy

Personal state consists of Discord user/guild IDs, named filter settings, delivery status, and Discord DM message IDs. Stentor does not persist DM contents. `/alerts forget-me confirm:true` deletes every subscription belonging to the invoking user; foreign-key cascades delete all associated delivery history.

## VPS efficiency

- One Node.js process and one PostgreSQL instance; no Redis or external queue.
- Five database connections by default.
- Node old-space is capped at 384 MiB and each container at 512 MiB.
- Keryx uses conditional ETag requests and batched upserts.
- Match fan-out happens only for newly discovered jobs, never for the full catalog.
- Search pagination state is bounded in memory to 1,000 sessions with a 15-minute TTL.
- Docker logs rotate, daily backups retain seven days, and a host watchdog checks readiness every minute.

## Security invariants

- Discord authorization is checked in command metadata and at runtime.
- Mentions are denied by default and public delivery can mention only the configured role.
- Admin links must be public HTTPS URLs without credentials, IP literals, nonstandard ports, shorteners, fragments, or common tracking parameters.
- Keryx link-confidence labels are preserved in every listing.
- PostgreSQL and health endpoints bind only to VPS loopback.
- Containers run the application as an unprivileged user and apply migrations under a PostgreSQL advisory lock.
- The bot filesystem is read-only, Linux capabilities are dropped, and `no-new-privileges` is enforced.
- Compose explicitly allowlists application variables instead of injecting deployment-only `.env` values.
- Production startup fails closed when the PostgreSQL or Discord credential is absent.
