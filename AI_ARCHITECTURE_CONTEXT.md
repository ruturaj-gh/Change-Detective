# Change Detective — AI Architecture Context

**Purpose:** Give an AI assistant enough current project context to provide
useful architectural guidance, implementation plans, and code changes.
**Last reviewed:** 2026-11-24

## How to use this document

Use this as orientation, not as permission to assume behavior that is not
implemented. Before proposing or changing a subsystem, inspect its current
source, tests, migrations, and package scripts. This repository is actively
evolving; existing code and tests take precedence over stale descriptions.

The root `CHANGE_DETECTIVE_PROJECT_BRIEF.md` contains valuable product
principles but includes an older Windows/local-only MVP specification. Where it
conflicts with the current hosted, multi-account and remote-agent direction,
prefer current implementation and `README.md`. Treat recommendations below as
proposals, not committed product decisions.

The Codespaces `creation.log` only records a successful development-container
startup; it is not evidence of application deployment or production readiness.

## Product and constraints

Change Detective's target direction is a device observability platform: the
web dashboard is the control centre, and an installed local agent is the
sensor. Its first observation domain is storage. The agent should preserve
historical measurements and evidence so users can understand what changed,
when it changed, and how complete the available evidence is.

Today, the implemented product measures directory sizes and available disk
metrics on user-approved roots, stores snapshots, compares scans, and presents
findings in a browser dashboard. Users can run an API-local scan or enroll a
separate foreground agent that polls the API and performs requested scans.
The agent now also performs local periodic scans, queues results in SQLite
while offline, and uses debounced recursive filesystem notifications to trigger
best-effort full rescans. A shared Node.js watcher delegates to the operating
system's notification backend; Linux, Windows, and macOS startup helpers run
the same foreground agent under the current user. These lifecycle integrations
still require validation on their target platforms.

Core constraints:

- Evidence comes first. Separate measured facts from deterministic findings
  and any future AI-generated interpretation; do not present a guess as fact.
- Scanning is read-only. Do not delete or modify user files, read file
  contents, or compute file hashes.
- Scan only the configured/approved root. Never follow symlinks or Windows
  reparse points; make incomplete coverage visible and comparisons appropriately
  cautious.
- Keep account, device, scan, finding, and settings access scoped to the
  authenticated account. Agent credentials must not be exposed in logs,
  command-line arguments, browser code, or source control.
- Preserve `bigint`-safe measurement handling: database/API byte counts are
  decimal strings at serialization boundaries, not JavaScript numbers.
- Keep the API private behind the web application/reverse proxy in deployment;
  HTTPS, production OAuth configuration, persistent secrets, database
  migration/backup plans, and independent-account validation are prerequisites
  to public exposure.
- Build for Linux, Windows, and macOS through one shared Node.js agent core.
  Validate Linux first in the development environment, then validate Windows
  and macOS on their target systems; Android/Termux is best-effort.

## Current architecture

This is an npm workspaces monorepo using TypeScript. Root scripts fan out to
workspace scripts (`dev`, `build`, `typecheck`, `test`, `lint`).

| Area | Responsibility | Main locations |
|---|---|---|
| Web dashboard | Next.js 14 app; account, login, scan history, findings, settings, and overview screens. Browser requests use same-origin `/api` endpoints. | `apps/web/src/app/`, `apps/web/src/components/`, `apps/web/src/lib/api.ts` |
| API | Fastify 4 REST API; session/auth middleware, account/device/scan/settings routes, Zod request validation, services, scheduler, and Prisma access. | `apps/api/src/server.ts`, `apps/api/src/routes/`, `apps/api/src/services/`, `apps/api/src/auth/` |
| Database | PostgreSQL through Prisma; schema and committed migrations are under the API workspace. | `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/` |
| Agent | Shared cross-platform Node.js process; enrolls once, stores credentials and a SQLite result queue locally, polls dashboard tasks, runs configured periodic scans, watches the approved root through a platform-neutral interface, and syncs results over HTTPS. Per-user systemd, launchd, and Task Scheduler helpers are available; no packaged installer is implemented. | `apps/agent/src/index.ts`, `apps/agent/src/local-store.ts`, `apps/agent/src/file-change-monitor.ts`, `apps/agent/scripts/` |
| Scanner | Database/API-independent filesystem measurement package shared by API and agent. Uses incremental traversal, `bigint`, cancellation, progress, and coverage/error reporting. | `packages/scanner/src/`, `packages/scanner/tests/` |
| Shared package | Present but currently only re-exports selected scanner types; do not assume API/web contract generation is implemented. | `packages/shared/src/index.ts` |
| Deployment | Docker Compose services for web, API, and PostgreSQL; cloud Compose supports an external PostgreSQL connection. | `compose.yaml`, `compose.cloud.yaml`, `Dockerfile` |

### Important runtime flows

**Authentication and account data**

1. The dashboard makes same-origin requests. The Next.js route/rewrite layer
   forwards API calls; browser code should not connect directly to PostgreSQL
   or hold server credentials.
2. The API authenticates a session and scopes data access through the user
   owning the relevant device. Preserve tenant scoping in every new read,
   update, delete, and comparison path.
3. Google OAuth is implemented. Account deletion and privacy acceptance are
   represented in the API and data model.

**Local scan**

1. A route calls the scan service, which creates a queued scan and returns its
   ID promptly.
2. In local mode, the API runs the scanner asynchronously and persists scan
   status, measurements, and findings.
3. The scanner enumerates immediate child directories and iteratively measures
   their trees. It does not retain the entire tree or read file contents.
4. The dashboard can poll status and request stored snapshots or comparison
   results.

**Remote agent scan**

1. A signed-in user requests a short-lived, single-use enrollment token.
2. The agent consumes it and receives a device ID and bearer credential. The
   API stores token hashes; the agent stores its credential in its per-user
   configuration directory with restrictive permissions on POSIX.
3. The agent polls for work, checks the requested root against its locally
   approved root, scans locally, renews a lease during long scans, and posts
   results. The API also returns the account scan interval; the agent performs
   periodic scans locally and can create their scan records when it uploads.
   Both dashboard-task and locally scheduled results are retained in the
   agent's SQLite queue until acknowledged.
4. The API validates device/task/root association, persists the result, and
   generates findings. Revocation invalidates the device credential and fails
   queued/running tasks.

**Comparison**

Scans are comparable only for the same device and normalized root. Completed
and partial scans can be compared; partial coverage and missing directories
must not be treated as reliable evidence of removal. The API uses `BigInt` for
byte deltas and returns byte values as strings.

### Product direction: local agent as the sensor

The intended product is more than a website that periodically scans storage.
The installed agent should eventually operate independently of the browser and
cloud connection, while the dashboard remains the place to manage devices and
investigate their history. Storage is the first observation domain, not a
commitment to collect every kind of system telemetry.

The implemented measurement model is hybrid:

- Periodic directory-size scans establish measured sizes and remain the source
  of truth for storage deltas.
- Recursive filesystem events are debounced and trigger a full rescan. They
  are timely signals, not measured deltas, and must not be treated as complete
  evidence. Notifications may be dropped, coalesced, or lack enough information
  to determine final sizes; periodic scans remain the fallback.
- Keep event details and any added observation capability explicitly scoped to
  user-approved roots and consent. Continue to avoid reading file contents or
  collecting more path detail than the investigation workflow needs.

Pending results and schedule state are persisted in SQLite under the agent's
private configuration directory. The result queue is bounded and the agent
pauses new scans and task polling near capacity rather than dropping evidence.
Uploads use outbound authenticated HTTPS and remain revocable. In agent mode,
the API scheduler does not create periodic tasks; the device owns that
schedule. Do not assume the API task handling is durable across API restarts or
suitable for multiple replicas.

## Data model landmarks

The Prisma schema currently models:

- `User`: Google identity, session version, privacy acceptance, and legacy
  account state.
- `Device`: account ownership, OS, approved root, agent credential hash, and
  last-seen timestamp.
- `AgentEnrollment`: hashed, expiring, one-time enrollment credentials.
- `Settings`: per-user monitored root, schedule interval, low-space threshold,
  and history retention.
- `Scan`: device/root, trigger/status, agent lease, disk metrics, and coverage.
- `DirectorySnapshot`: per-scan directory measurements and completeness.
- `Finding`: deterministic finding type/severity, explanation, evidence, and
  resolution state.

When changing persisted behavior, update Prisma schema and add a migration;
review migration safety and upgrade/rollback implications. Do not use
`prisma db push` as a substitute for a committed migration.

## Engineering guidance for future work

For each proposed change:

1. State the user outcome and the observed current behavior.
2. Trace the relevant request/data flow through UI, API route, service,
   persistence, and tests before choosing a design.
3. Identify account-boundary, agent trust, privacy, filesystem, partial-scan,
   and data-migration implications.
4. Prefer a small vertical slice and existing patterns. Avoid new services,
   queues, abstractions, or dependencies without a concrete requirement.
5. Add focused tests for introduced behavior and its important failure cases.
   Keep API contracts, schema validation, serialization, and UI expectations
   consistent.
6. Run the smallest relevant test/typecheck/build, then broaden validation if
   needed. Verify migrations and deployment configuration when relevant.
7. Report verified facts, assumptions, and remaining work separately.

Useful repository commands:

```bash
npm test
npm run typecheck
npm run build
npm test --workspace @change-detective/api
npm test --workspace @change-detective/scanner
npm test --workspace @change-detective/web
```

The API workspace's lifecycle scripts build the scanner and generate the
Prisma client before several commands. The README documents environment setup,
OAuth, Compose, migrations, and deployment cautions.

## Suggested development sequence

These are architectural recommendations based on the current documented
status. Reassess them against current code and product priorities before
starting each item.

### 1. Validate the shared cross-platform agent

- Keep one TypeScript agent and scanner core across Linux, Windows, and macOS;
  isolate OS notification and startup integrations behind small adapters.
- Develop and test the shared flow on Linux first, then validate enrollment,
  polling, task leases, result sync, revocation, and filesystem events on
  Windows and macOS before making platform support commitments.
- Validate the per-user systemd, LaunchAgent, and Task Scheduler
  install/uninstall scripts on their respective platforms.
- Make configuration, structured logs, graceful shutdown, and clear states for
  offline, revoked, and re-enrollment cases part of the agent's supported
  operating experience.

**Exit criteria:** Linux, Windows, and macOS users can install/run, enroll,
observe agent health, perform scans, recover from process restarts, and
revoke/re-enroll with tested platform-specific instructions. Do not claim
production support until validated on the corresponding systems.

### 2. Validate local collection and recovery

- Local periodic scans, a bounded SQLite upload queue, and retry after network
  loss or agent restart are implemented. Verify schedule changes, result
  idempotency, queue capacity, and recovery behavior on target systems.
- Filesystem events are best-effort signals that trigger full rescans; periodic
  measured scans remain authoritative. Validate watcher overflow, unsupported
  filesystems, and resource usage on Linux first, then Windows and macOS.
- Test offline periods, missed schedules, full queues, agent restarts, dropped
  event notifications, and platform-specific filesystem edge cases.

**Exit criteria:** Target-platform testing confirms local observations continue
without the cloud, pending results survive restarts within defined limits, and
synchronization after reconnect is safe and repeatable.

### 3. Validate cloud synchronization and operations

- Exercise OAuth and account creation against a live, non-production
  PostgreSQL database and HTTPS-capable test deployment.
- Test two independent accounts end-to-end: devices, settings, scans, findings,
  history, and account deletion must remain isolated.
- Validate agent enrollment, single-use/expiry, polling, lease renewal, result
  submission, offline retry, root changes, revocation, and re-enrollment.
- Define production secrets, HTTPS/reverse-proxy boundaries, OAuth callback
  configuration, logging/redaction, backups, restore drills, and migration
  rollout procedure.
- Add operational visibility for queued/running/stale scans, agent last-seen
  state, lease expiry, and scheduler/retention failures without logging
  credentials or sensitive path data unnecessarily.
- Decide how scheduling and background work should behave across restarts and
  multiple API replicas. The current scheduler and local scan execution are
  in-process; do not assume they provide durable, distributed job execution.
- Confirm resource limits and failure handling for large agent result payloads
  and long-running scans.

**Exit criteria:** A documented deployment and recovery runbook is validated
against a staging setup, including restoring a backup and applying migrations.

### 4. Package and support the agent across platforms

- Validate and document platform-specific filesystem permissions and limits
  for Linux, Windows, and macOS.
- Add packaged upgrade/uninstall flows after the user-level startup helpers
  are validated.
- Keep setup and device health understandable without exposing credentials.

**Exit criteria:** Every advertised platform has a tested installation,
startup, operation, update, and revocation path.

### 5. Make the dashboard investigative; expand scope only from validated needs

- Improve investigation and explainability using measured deltas, coverage,
  history, event context where available, and explicit confidence/limitations.
- Validate user needs before adding AI diagnosis or broader system monitoring.
- If adding AI, keep it optional and downstream of access-controlled evidence;
  minimize transmitted data, disclose what is sent, and distinguish generated
  hypotheses from measurements.
- Consider additional observation domains (for example Docker storage,
  application changes, or service health) as separate bounded capabilities
  with their own consent, data model, tests, and retention implications. Do not
  generalize the schema or collect broad telemetry prematurely.

**Exit criteria:** The dashboard helps users investigate a concrete change
from measured, access-controlled evidence; each new observation capability
has a validated user problem, privacy review, and tested workflow.

## Questions to resolve when they become relevant

- Is production expected to run one API process or multiple replicas? This
  affects in-process scheduling, local scans, task claiming, and durable work.
- What startup, packaging, and support guarantees are required for Linux,
  Windows, and macOS before claiming each platform is supported?
- What is the acceptable scan duration/result size and behavior under API
  outages or agent restarts? What local queue size and retention are acceptable?
- How should local periodic scheduling coordinate with dashboard-requested
  tasks, especially while the cloud is unavailable?
- Which deployment/backup provider and recovery objectives are required?
- Should future AI processing be local or hosted, and what exact scan metadata
  may be shared?

Do not block unrelated, well-scoped work on these questions. Surface them when
a proposed change depends on their answers.
