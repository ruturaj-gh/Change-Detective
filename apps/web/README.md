# @change-detective/web

Next.js local dashboard for Change Detective. The overview, directory changes, scan history, findings, and settings screens use the local Fastify API. The overview shows measured storage and scan coverage; findings display deterministic rules and evidence without inferring a cause.

The API (Fastify, port 3001) and PostgreSQL must be available for live data. The UI presents loading, empty, and API error states when they are not.

## Dev

```powershell
# From apps/web/
npm run dev    # http://localhost:3000
```

The dashboard proxies `/api` requests to `http://127.0.0.1:3001`. Set `NEXT_PUBLIC_API_URL` in `.env.local` only if the API uses a different local address. Keep the API bound to localhost.

## Current limits

- Retention is saved as a setting, but automatic history cleanup is not implemented.
- Scheduled scans only run while the API process is active.
- The dashboard does not diagnose the cause of storage changes.

