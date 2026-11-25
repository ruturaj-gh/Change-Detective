# Change Detective

> **Browser-based storage history** — understand what changed on your computer, starting with disk/storage growth.

The dashboard is a web app. Local development can run the API, scanner, and PostgreSQL on Linux, macOS, or Windows. A separately installed Node.js agent connects outbound to report scans from those same platforms. Android support is best-effort through Termux; this is not a native Android app.

Storage is the initial observation domain. The agent architecture can support
separately consented capabilities later, but Change Detective does not aim to
collect broad process, application, or system telemetry by default.

> [!NOTE]
> **Current status:** Per-account data isolation, Google OAuth sign-in, per-account devices and settings, account deletion, and an outbound multi-platform agent protocol are implemented. Windows, macOS, and Linux agent deployments still need validation on their target platforms; Android is best-effort through Termux. The hosted flow still needs validation with production Google OAuth, a live database, HTTPS, and independent accounts. Do not expose the service publicly until those checks and production deployment controls are complete.

---

## Quick start

### Run the whole app with Docker Compose

Docker Compose runs the dashboard, API, and PostgreSQL. The database is kept
in a named volume, so it survives container restarts and rebuilds.

Prerequisite: Docker Engine with the Compose plugin (`docker compose`).

```bash
cp .env.example .env
```

In the root `.env`, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and a
persistent `AUTH_SECRET` (`openssl rand -hex 32`). Set `POSTGRES_PASSWORD` to a
URL-safe value (for example, `openssl rand -hex 24`). For local use, keep
`NODE_ENV=development` and `PUBLIC_APP_URL=http://localhost:3000`. Add
`http://localhost:3000/api/auth/google/callback` to the Google OAuth client's
authorized redirect URIs.

For a deployed HTTPS host, set `NODE_ENV=production` and set
`PUBLIC_APP_URL` to that host's HTTPS origin. Production startup requires
Google OAuth credentials and a persistent `AUTH_SECRET`.

Start the services:

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f api web
```

Open `http://localhost:3000`. The API applies pending Prisma migrations before
starting. Back up existing data before the first start if upgrading an
existing database. To rebuild after pulling or changing source:

```bash
docker compose up --build -d
```

Stop the containers but keep database data with `docker compose down`. **Do not
run `docker compose down -v` unless you intend to permanently delete the
PostgreSQL data volume.**

The Compose PostgreSQL volume persists across Codespace restarts/rebuilds, but
is deleted if you delete the Codespace. Use a managed PostgreSQL database for
data you need to keep independently of the Codespace.

#### Use a managed cloud PostgreSQL database

Create a database with a PostgreSQL provider and copy its direct connection
string (with SSL enabled, if required by the provider). Put it in the root
`.env` as `COMPOSE_DATABASE_URL`, then start the app without the bundled
PostgreSQL service:

```bash
docker compose -f compose.cloud.yaml up --build -d
```

In Codespaces, `COMPOSE_DATABASE_URL`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, and `AUTH_SECRET` can be stored as Codespaces/repository
secrets instead of in `.env`; the Compose file passes them to the API. Keep
`PUBLIC_APP_URL` specific to the Codespace in `.env`, and add its Google OAuth
callback URL to the OAuth client.

To move data from local PostgreSQL, first create a backup from the machine that
can access that database, then restore it to the new, empty cloud database
before starting the cloud Compose stack:

```bash
pg_dump --format=custom --no-owner --no-acl \
  --dbname="$LOCAL_DATABASE_URL" --file=change-detective.dump
pg_restore --no-owner --no-acl \
  --dbname="$COMPOSE_DATABASE_URL" change-detective.dump
```

Set `LOCAL_DATABASE_URL` and `COMPOSE_DATABASE_URL` in that terminal to the
respective connection strings; do not commit them or the dump file. If your
local scans belong to the legacy owner, set `BOOTSTRAP_EMAIL` to the Google
email that should own them before its first sign-in. Back up the source database
and restore only into a fresh target database.

#### GitHub Codespaces

Open the repository in a Codespace and rebuild the dev container if prompted;
the included dev-container configuration provides Docker. The API detects the
Codespace's forwarded HTTPS origin when `PUBLIC_APP_URL` is still set to its
localhost default. Add
`https://YOUR-CODESPACE-NAME-3000.app.github.dev/api/auth/google/callback`
to Google Cloud's authorized redirect URIs, replacing the name with the
Codespace's actual forwarded URL. Forward port 3000 in Codespaces and make it
public if Google needs to reach the OAuth callback; keep the API and database
ports private. Set `PUBLIC_APP_URL` explicitly if using a custom dashboard
domain.
Then run the same `docker compose up --build -d` command and open the forwarded
port URL.

Local-mode scans run inside the API container and therefore see the container
filesystem, not the Codespace host filesystem. For scanning the Codespace (or
another device), set `SCAN_MODE=agent`, rebuild/restart the stack, then enroll
and run the agent from that device using the command shown in **Settings**.
The agent connects through the forwarded dashboard URL.

Compose creates a separate PostgreSQL database and does not automatically
import a database installed directly on the host. Export and restore existing
data separately if you need to keep it.

### Run directly on your machine (without Docker)

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | v20+ (tested on v25.9.0) |
| npm | v7+ |
| PostgreSQL | 14+ |

### 1. Clone and install

```bash
git clone <repo-url> change-detective
cd change-detective
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and set your DATABASE_URL:
# DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@127.0.0.1:5432/change_detective
```

Accounts use Google OAuth. In Google Cloud Console, configure the OAuth consent
screen and create an OAuth client ID for a web application. While the consent
screen is in testing mode, add your Google account as a test user. Add this
authorized redirect URI:

```text
http://localhost:3000/api/auth/google/callback
```

Set the client values in the repository-root `.env`:

```dotenv
PUBLIC_APP_URL=http://localhost:3000
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
AUTH_SECRET=<at-least-32-random-bytes>
```

Generate `AUTH_SECRET` with `openssl rand -hex 32`. For production, set
`PUBLIC_APP_URL` to the HTTPS dashboard origin and add
`https://your-dashboard.example/api/auth/google/callback` as an authorized
redirect URI in Google Cloud Console. If existing legacy device data should be
assigned to a particular Google account, set `BOOTSTRAP_EMAIL` to that account
before its first sign-in. New accounts are created on first Google sign-in.
The app does not receive or store Google passwords and does not send account
emails. Existing email/password accounts are linked to Google when signing in
with the same verified email address. Back up the database before migrating:
the Google OAuth migration removes the obsolete password-hash column and email
action-token table.

### 3. Create the database

```sql
-- In psql or pgAdmin:
CREATE DATABASE change_detective;
```

### 4. Run migrations and seed the local device

```bash
npm run db:migrate --workspace @change-detective/api
npm run db:seed --workspace @change-detective/api
```

The Prisma workspace commands load `DATABASE_URL` from the repository-root
`.env` file, matching the API and seed scripts. Docker Compose sets
`DATABASE_URL` internally for its bundled database; use `COMPOSE_DATABASE_URL`
with `compose.cloud.yaml` for a managed database.

### 5. Start the API and dashboard

```bash
npm run dev
```

This builds the scanner package, generates the Prisma client, then starts the API
and dashboard concurrently.
Open `http://localhost:3000` in your browser.

### 6. Verify

```bash
curl http://127.0.0.1:3001/api/health
# {"api":"ok","database":"ok","timestamp":"..."}
# Then open http://localhost:3000 in your browser.
```

## Accounts and remote scanning agents

Each account has isolated devices, scan history, findings, and settings. Users
can enroll multiple devices from Settings. Device records are tied to the
account that generated the one-time enrollment token; agent tokens are stored
as hashes. The service does not use MAC addresses for identity.

The agent polls the API over HTTPS for scan requests and uploads directory-level
measurements. It does not open an inbound port. It only scans the absolute root
configured in its local agent file; a different root received from the server is
refused. Agent credentials are saved under
`$XDG_CONFIG_HOME/change-detective/agent.json` (or `~/.config/...`) on
Linux/macOS/Termux, with directory/file permissions `0700`/`0600`. Windows
stores it under `%APPDATA%\change-detective\agent.json` and relies on the
current user's inherited Windows ACLs. The agent also stores its SQLite upload
queue and schedule state as `agent.sqlite` in the same private configuration
directory.

The agent runs periodic full scans using the account's configured interval, so
collection continues while the API is unreachable. Completed results remain
in the local SQLite queue and are retried until the API acknowledges them. The
queue is bounded; when it nears capacity, new scans and task polling pause
rather than discarding queued evidence. Recursive filesystem notifications
are best-effort signals that trigger a debounced full scan; periodic scans
remain the measurement baseline. Node's shared filesystem watcher uses the
platform backend (inotify on Linux, ReadDirectoryChangesW on Windows, and
FSEvents on macOS). If the platform cannot watch the approved root, the agent
logs that event monitoring is unavailable and continues with periodic scans.

For a hosted setup:

1. Apply migrations and configure the API with `SCAN_MODE=agent`, production
   authentication/email variables, and PostgreSQL. Keep the API private behind the
   web application/reverse proxy; expose only the HTTPS web endpoint.
2. Sign in, open **Settings**, and create a one-time enrollment token.
3. Each user signs in to their own account. On a scanning computer, install Node.js 20+, clone/install this project,
   select the matching Bash or PowerShell setup snippet in Settings, and enter
   the token at its hidden prompt. The enrollment token expires after 15 minutes
   and is single-use. Android users need Termux with Node.js and must run
   `termux-setup-storage` before choosing an accessible monitored directory.
4. Keep the agent process running. Dashboard scans are queued for it;
   it polls every 30 seconds and renews long-running task leases. Periodic
   local scans and event-triggered rescans run independently of dashboard
   requests. Build the agent before installing a per-user startup task:
   - Linux: `bash apps/agent/scripts/install-linux-user-service.sh`
     (systemd user service); remove with
     `bash apps/agent/scripts/uninstall-linux-user-service.sh`.
   - macOS: `bash apps/agent/scripts/install-macos-launch-agent.sh`
     (LaunchAgent); remove with
     `bash apps/agent/scripts/uninstall-macos-launch-agent.sh`.
   - Windows: run
     `.\apps\agent\scripts\install-windows-startup.ps1` from the repository
     root in PowerShell (Task Scheduler); remove with
     `.\apps\agent\scripts\uninstall-windows-startup.ps1`.
5. To revoke access, use **Revoke access** in Settings. Existing snapshots are
   retained, while queued/running scans are failed.

The systemd user service, LaunchAgent, and Windows logon task all run the
agent as the current user; none requires a kernel module or administrator
privileges for ordinary user-owned roots. A packaged installer, deployment
automation, and live database/reverse-proxy validation remain future work.
Android/Termux is best-effort and depends on filesystem API and permission
support. If changing the monitored root, update the local agent configuration
file as well. After revoking an agent, remove its saved local credential and
local queue before enrolling it again:

```bash
rm -- "${XDG_CONFIG_HOME:-$HOME/.config}/change-detective/agent.json"
rm -- "${XDG_CONFIG_HOME:-$HOME/.config}/change-detective/agent.sqlite"
```

On Windows, remove `%APPDATA%\change-detective\agent.json` and
`%APPDATA%\change-detective\agent.sqlite` from the scanning user's profile.

Never put the enrollment token or agent bearer token in a command-line
argument, source control, or logs.

---

## Scripts

| Command | Description |
|---|---|
| `npm install` | Install all workspace dependencies |
| `npm test` | Run all tests across all packages |
| `npm run typecheck` | Type-check all packages |
| `npm run dev` | Build the scanner and start the API and dashboard in parallel |

### Per-package

```bash
# Scanner tests
cd packages/scanner && npm test

# API tests
cd apps/api && npm test

# DB commands (from apps/api/)
npx prisma migrate dev --name <migration-name>   # Create a new migration
npx prisma migrate deploy                         # Apply pending migrations
npx prisma studio                                 # Browse database
npm run db:seed                                   # Seed device + settings rows
```

---

## Architecture

```
change-detective/
├── apps/
│   ├── api/          Fastify + TypeScript REST API (port 3001)
│   │   ├── src/
│   │   │   ├── routes/       GET/POST/PATCH endpoints
│   │   │   ├── services/     Scan, findings, settings logic
│   │   │   ├── scheduler/    Periodic scan scheduler
│   │   │   ├── config/       Device ID management
│   │   │   └── db/           Prisma client + seed
│   │   └── prisma/           schema.prisma + migrations
│   ├── agent/        Cross-platform Node.js agent that polls and uploads results
│   │   └── src/
│   └── web/          Next.js browser dashboard (port 3000)
├── packages/
│   └── scanner/      Cross-platform filesystem scanner (no DB dependency)
└── db/               Reference SQL (Prisma manages actual migrations)
```

### API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | API + database status |
| `GET` | `/api/devices` | Local or enrolled agent device info |
| `GET` | `/api/scans` | List recent scans |
| `POST` | `/api/scans` | Start a manual scan (async, 202) |
| `POST` | `/api/agents/enrollment` | Issue one-time agent enrollment token (signed-in user) |
| `POST` | `/api/agent/enroll` | Consume enrollment token and receive agent credential |
| `GET` | `/api/agent/tasks/next` | Poll for a scan task (agent bearer credential) |
| `POST` | `/api/agent/scans/:id/results` | Submit a scan result (agent bearer credential) |
| `GET` | `/api/scans/:id` | Scan status and summary |
| `GET` | `/api/scans/:id/directories` | Directory measurements |
| `GET` | `/api/scans/:id/changes` | Delta vs previous scan; optional `previousScanId` selects an earlier baseline from the same root |
| `GET` | `/api/findings` | List findings |
| `GET` | `/api/settings` | Current settings |
| `PATCH` | `/api/settings` | Update settings |

---

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `API_HOST` | `127.0.0.1` | Bind address (do not change to `0.0.0.0` — see security notes) |
| `API_PORT` | `3001` | API port |
| `NODE_ENV` | `development` | `development` or `production`; production requires HTTPS, Google OAuth credentials, and `AUTH_SECRET` |
| `SCAN_MODE` | `local` | `local` scans on the API host; `agent` queues scans for each user's enrolled agent |
| `PUBLIC_APP_URL` | `http://localhost:3000` | Dashboard origin and Google OAuth callback base; HTTPS is required in production |
| `AUTH_SECRET` | generated per development process | Session-signing secret; set a persistent value of at least 32 bytes in production |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | — | OAuth web application credentials from Google Cloud Console |
| `BOOTSTRAP_EMAIL` | — | Optional Google account email allowed to claim existing legacy data |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Compose development defaults | Credentials for the Compose PostgreSQL container; use a strong URL-safe password outside local development |

---

## Security notes

- The API binds to `127.0.0.1` (localhost only) by default. **Do not expose it to the network.**
- Database credentials stay in `.env` — never commit `.env`.
- Change the development PostgreSQL password before using Docker Compose on a shared or publicly reachable host.
- In Compose, only the web port is published by default; keep the API and PostgreSQL on the private Compose network.
- The dashboard requires Google sign-in. Keep OAuth client secrets and `AUTH_SECRET` out of source control.
- The agent sends measurements only to its enrolled service over HTTPS.
- User data is scoped by account. Configure Google OAuth and HTTPS before deploying the portal publicly.
- Scan and finding history is automatically cleaned according to each account's configured retention period.
- The scanner never reads file contents or computes hashes.
- No files are deleted or modified by this tool.

---

## Database backup and restore

### Backup

```bash
pg_dump -U postgres change_detective -F c -f change_detective_backup.dump
```

### Restore

```bash
pg_restore -U postgres -d change_detective change_detective_backup.dump
```

### History cleanup

History retention is configurable (1–3650 days) per account. The scheduler
periodically deletes expired scans, directory snapshots, and findings. Keep
database backups under an appropriate retention policy as well; cleanup does
not remove already-created backups.

---

## Limitations

- **Symlink/junction skipping:** Requires elevated privileges to create test symlinks. The scanner skips all Windows reparse points by design to prevent double-counting.
- **Logical file size:** Reports `stat.size` (logical bytes), not allocated disk blocks. Drive totals will differ from OS-reported used space due to filesystem overhead, sparse files, and protected paths.
- **Scheduled scans:** In agent mode, the enrolled agent runs local periodic scans while its process is active and queues results offline. In local scan mode, scheduled scans still depend on the API process being alive.
- **First scan = baseline:** No change detection until a second scan completes against the same root.
- **Android scanning:** Android requires a separately installed Termux agent and explicit storage permission; using the dashboard in an Android browser alone does not scan phone storage.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `ECONNREFUSED` on API health | Check PostgreSQL is running: `pg_isready` |
| `DATABASE_URL` error | Verify `.env` has correct credentials |
| Migration error | Check `npx prisma migrate status` |
| Docker containers are unhealthy | Run `docker compose ps` and `docker compose logs api db`; check OAuth and database settings in `.env` |
| Scan stuck in `running` | Restart the API — stale scans are recovered automatically on startup |
| Symlink test skipped | Check whether your user has permission to create symlinks in the test environment |

---

## Tech stack

| Component | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | All packages |
| API | Fastify 4 | Localhost-only |
| ORM / DB | Prisma 5 + PostgreSQL | Committed migrations |
| Scanner | Node.js `fs/promises` | Linux and Windows paths |
| Validation | Zod | API input + settings |
| Tests | Vitest | All packages |
| Frontend | Next.js 14 | Responsive dashboard and account portal |

