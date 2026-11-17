# @change-detective/web

Next.js local dashboard for Change Detective. The overview, directory changes, scan history, findings, and settings screens use the local Fastify API. The overview shows measured storage and scan coverage; findings display deterministic rules and evidence without inferring a cause.

The API (Fastify, port 3001) and PostgreSQL must be available for live data. The UI presents loading, empty, and API error states when they are not. Accounts use Google OAuth; configure the Google OAuth web client on the API, keep the API private behind the web app, use HTTPS, and set `SCAN_MODE=agent` when user-owned remote devices should scan their own storage.

## Dev

```bash
# From apps/web/
npm run dev    # http://localhost:3000
```

The dashboard proxies `/api` requests to `http://127.0.0.1:3001`. Set `NEXT_PUBLIC_API_URL` in `.env.local` only if the API uses a different internal address. Keep the API private; the scanning agent connects outbound to the public HTTPS dashboard origin.

## Current limits

- Scan and finding history is automatically cleaned according to each account's retention setting while the API scheduler is running. Database backups have a separate retention policy.
- Scheduled scans only run while the API process is active.
- The dashboard does not diagnose the cause of storage changes.
- Google OAuth must be configured on the API. Set the Google Cloud Console redirect URI to `<PUBLIC_APP_URL>/api/auth/google/callback`.
- Agent enrollment is available from Settings. The Node.js agent supports Windows, macOS, and Linux; Android is best-effort through Termux and requires storage permissions. It polls for queued work and stores its bearer token under the current user's configuration directory.
- Run the API with `SCAN_MODE=agent` in hosted deployments so scans are queued for an enrolled agent rather than run on the server.

