# Change Detective

> **Browser-based storage history** — understand what changed on your computer, starting with disk/storage growth.

The dashboard is a web app. Local development can run the API, scanner, and PostgreSQL on Linux or Windows. The hosted direction is a single-user dashboard with sign-in and a Linux agent that connects outbound to report scans.

> [!NOTE]
> **Current status:** Linux/Windows local scanning, single-user authentication, and an outbound Linux agent protocol are implemented. The agent flow still needs validation against a live database and HTTPS deployment. Do not expose the service publicly until you have completed those checks and configured an HTTPS reverse proxy.

---

## Quick start

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

For local development, sign-in is disabled unless authentication variables are set.
Production mode fails to start unless `AUTH_EMAIL`, `AUTH_PASSWORD_HASH`, and
`AUTH_SECRET` are configured. Generate the password hash interactively (input is
not echoed) with:

```bash
npm run auth:hash-password --workspace @change-detective/api
openssl rand -hex 32
```

Copy the hash and a newly generated secret into the server's environment. A
production deployment must use HTTPS and keep the API behind the web app or a
trusted private network; do not expose the API port directly.

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

### 5. Start the API and dashboard

```bash
npm run dev
```

This builds the scanner package, then starts the API and dashboard concurrently.
Open `http://localhost:3000` in your browser.

### 6. Verify

```bash
curl http://127.0.0.1:3001/api/health
# {"api":"ok","database":"ok","timestamp":"..."}
# Then open http://localhost:3000 in your browser.
```

## Hosted Linux agent (early implementation)

The agent polls the API over HTTPS for scan requests and uploads directory-level
measurements. It does not open an inbound port. It only scans the absolute root
configured in its local agent file; a different root received from the server is
refused. Agent credentials are saved under
`$XDG_CONFIG_HOME/change-detective/agent.json` (or `~/.config/...`) with
directory/file permissions `0700`/`0600`.

For a hosted setup:

1. Apply migrations and configure the API with `SCAN_MODE=agent`, production
   authentication variables, and PostgreSQL. Keep the API private behind the
   web application/reverse proxy; expose only the HTTPS web endpoint.
2. Sign in, open **Settings**, and create a one-time enrollment token.
3. On the Linux computer, clone/install this project, paste the token at the
   hidden prompt shown in Settings, and run
   `npm run agent:start --workspace @change-detective/agent`. The enrollment
   token expires after 15 minutes and is single-use.
4. Keep the Linux agent process running. Dashboard scans are queued for it;
   it polls every 30 seconds and renews long-running task leases.
5. To revoke access, use **Revoke access** in Settings. Existing snapshots are
   retained, while queued/running scans are failed.

The agent is currently started in a foreground terminal; a systemd service,
installer, deployment automation, and live database/reverse-proxy validation
are still future work. If changing the monitored root, update the local agent
configuration file as well. After revoking an agent, remove its saved local
credential before enrolling it again:

```bash
rm -- "${XDG_CONFIG_HOME:-$HOME/.config}/change-detective/agent.json"
```

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
│   ├── agent/        Linux agent that polls the API and uploads scan results
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
| `NODE_ENV` | `development` | `development` or `production` |

---

## Security notes

- The API binds to `127.0.0.1` (localhost only) by default. **Do not expose it to the network.**
- Database credentials stay in `.env` — never commit `.env`.
- The hosted dashboard requires sign-in; local development authentication is disabled by default.
- The Linux agent sends measurements only to its enrolled service over HTTPS.
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

History retention is configurable (1–3650 days) via `PATCH /api/settings`.  
Retention cleanup is **not** automatic in the MVP — run it manually if needed:

```sql
-- Delete scans older than N days (replace 90 with your retention days):
DELETE FROM scans WHERE started_at < NOW() - INTERVAL '90 days'
  AND id NOT IN (SELECT scan_id FROM findings WHERE resolved_at IS NULL);
```

---

## Limitations

- **Symlink/junction skipping:** Requires elevated privileges to create test symlinks. The scanner skips all Windows reparse points by design to prevent double-counting.
- **Logical file size:** Reports `stat.size` (logical bytes), not allocated disk blocks. Drive totals will differ from OS-reported used space due to filesystem overhead, sparse files, and protected paths.
- **Scheduled scans:** Only run while the API process is alive. If the process stops, scheduled scans do not occur (by design).
- **First scan = baseline:** No change detection until a second scan completes against the same root.
- **Single device:** The MVP manages one local device. The schema supports multiple devices for future expansion.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `ECONNREFUSED` on API health | Check PostgreSQL is running: `pg_isready` |
| `DATABASE_URL` error | Verify `.env` has correct credentials |
| Migration error | Check `npx prisma migrate status` |
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
| Frontend | Next.js (planned) | Phase 4 |

