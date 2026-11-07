# Change Detective

> **Local-first Windows app** — understand what changed on your computer, starting with disk/storage growth.

Change Detective scans your drive's directories, stores timestamped snapshots in PostgreSQL, compares successive scans, and presents changes and warnings in a local web dashboard.

> [!NOTE]
> **Current status:** Scanner, API, and dashboard are implemented. Local end-to-end use requires PostgreSQL and a configured root `.env` file.

---

## Quick start

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | v20+ (tested on v25.9.0) |
| npm | v7+ |
| PostgreSQL | 14+ (natively installed on Windows, not Docker) |

### 1. Clone and install

```powershell
git clone <repo-url> change-detective
cd change-detective
npm install
```

### 2. Configure environment

```powershell
copy .env.example .env
# Edit .env and set your DATABASE_URL:
# DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@127.0.0.1:5432/change_detective
```

### 3. Create the database

```sql
-- In psql or pgAdmin:
CREATE DATABASE change_detective;
```

### 4. Run migrations and seed the local device

```powershell
npm run db:migrate --workspace @change-detective/api
npm run db:seed --workspace @change-detective/api
```

### 5. Start the API and dashboard

```powershell
# Terminal 1: API at http://127.0.0.1:3001
npm run dev --workspace @change-detective/api

# Terminal 2: dashboard at http://localhost:3000
npm run dev --workspace @change-detective/web
```

### 6. Verify

```powershell
curl http://127.0.0.1:3001/api/health
# {"api":"ok","database":"ok","timestamp":"..."}
# Then open http://localhost:3000 in your browser.
```

---

## Scripts

| Command | Description |
|---|---|
| `npm install` | Install all workspace dependencies |
| `npm test` | Run all tests across all packages |
| `npm run typecheck` | Type-check all packages |
| `npm run dev` | Start all apps in dev mode |

### Per-package

```powershell
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
│   └── web/          Next.js dashboard (port 3000) — coming in Phase 4
├── packages/
│   └── scanner/      Isolated Windows filesystem scanner (no DB dependency)
└── db/               Reference SQL (Prisma manages actual migrations)
```

### API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | API + database status |
| `GET` | `/api/devices` | Local device info |
| `GET` | `/api/scans` | List recent scans |
| `POST` | `/api/scans` | Start a manual scan (async, 202) |
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
- No telemetry is sent off-device.
- The scanner never reads file contents or computes hashes.
- No files are deleted or modified by this tool.

---

## Database backup and restore

### Backup

```powershell
pg_dump -U postgres change_detective -F c -f change_detective_backup.dump
```

### Restore

```powershell
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
| Symlink test skipped | Run tests as Administrator to enable symlink creation |

---

## Tech stack

| Component | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | All packages |
| API | Fastify 4 | Localhost-only |
| ORM / DB | Prisma 5 + PostgreSQL | Committed migrations |
| Scanner | Node.js `fs/promises` | No DB dependency |
| Validation | Zod | API input + settings |
| Tests | Vitest | All packages |
| Frontend | Next.js (planned) | Phase 4 |

