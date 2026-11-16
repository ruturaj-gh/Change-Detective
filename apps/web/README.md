# @change-detective/web

Next.js local dashboard for Change Detective. The overview, directory changes, scan history, findings, and settings screens use the local Fastify API. The overview shows measured storage and scan coverage; findings display deterministic rules and evidence without inferring a cause.

The API (Fastify, port 3001) and PostgreSQL must be available for live data. The UI presents loading, empty, and API error states when they are not. In hosted deployments, keep the API private behind the web app and use HTTPS.

## Dev

```bash
# From apps/web/
npm run dev    # http://localhost:3000
```

The dashboard proxies `/api` requests to `http://127.0.0.1:3001`. Set `NEXT_PUBLIC_API_URL` in `.env.local` only if the API uses a different internal address. Keep the API private; the Linux agent connects outbound to the public HTTPS dashboard origin.

## Current limits

- Retention is saved as a setting, but automatic history cleanup is not implemented.
- Scheduled scans only run while the API process is active.
- The dashboard does not diagnose the cause of storage changes.
- Agent enrollment is available from Settings. The Linux agent polls for queued work and stores its bearer token under `~/.config/change-detective/agent.json` with restrictive permissions.
- Run the API with `SCAN_MODE=agent` in hosted deployments so scans are queued for an enrolled agent rather than run on the server.

