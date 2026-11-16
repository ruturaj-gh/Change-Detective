# Change Detective --- Product & Engineering Handoff

**Document type:** Product requirements, workflow, architecture, and
implementation guide\
**Status:** MVP specification\
**Primary goal:** Give this document to a coding agent as the canonical
project brief.

> **Updated direction:** The agreed target is a single-user hosted web
> dashboard, accessible over the internet with sign-in, plus a Linux
> agent on the user's computer. The agent must initiate an authenticated,
> encrypted outbound connection and scan only user-approved local paths.
> Single-user email/password authentication and a Linux agent's
> one-time enrollment, outbound polling, scan delivery, and revocation
> foundations are implemented. They still require live database and
> HTTPS deployment validation. Do not expose the service publicly until
> those checks and production deployment configuration are complete.
> The Windows-first MVP requirements below are historical and are
> superseded wherever they conflict with this direction.

------------------------------------------------------------------------

## 1. Executive summary

**Change Detective** is a local-first, open-source Windows application
that helps a user understand what changed on their computer, starting
with disk/storage growth.

The first version scans a selected drive's top-level directories,
recursively measures their contents, stores timestamped snapshots in
PostgreSQL, compares successive comparable scans, and presents changes
and warnings in a local web dashboard.

The core promise is:

> "Show me what changed on my computer, where the change happened, and
> what the available evidence can---and cannot---tell me."

This is not initially a general antivirus, cleanup utility, AI agent, or
full system-monitoring suite. It starts with reliable storage history
and a good investigation workflow. The architecture should allow later
expansion into Docker resource changes, port conflicts, service health
checks, network diagnostics, and other system observations without
prematurely implementing those features.

### Product principles

1.  **Local-first:** The MVP runs on the user's Windows computer. No
    cloud backend is required.
2.  **Zero-cost operation:** Use open-source tools and locally installed
    software. No paid APIs or mandatory paid hosting.
3.  **Evidence before explanations:** Report measured facts separately
    from inferred causes.
4.  **Privacy by default:** Do not upload telemetry. Do not read file
    contents. Do not collect filenames beyond the paths needed for the
    selected directory-level analysis.
5.  **Safe by default:** Never delete files, kill processes, or make
    system changes automatically.
6.  **Reliable measurements:** Incomplete scans must be clearly
    identified and must not be treated as definitive.
7.  **Incremental scope:** Deliver a working vertical slice before
    adding integrations or AI.
8.  **Maintainability:** Use clear types, tests, migrations,
    configuration validation, and documented decisions.

------------------------------------------------------------------------

## 2. Target user and problem

### Initial audience

Windows developers and power users who use their computers for
development, downloads, containers, databases, and multiple projects.

### Example problems

-   A drive loses several gigabytes overnight.
-   A directory grows significantly without the user understanding why.
-   Free space is approaching a configured threshold.
-   The user wants to compare current storage usage with a previous
    scan.
-   A scan cannot fully inspect some directories, and the user needs to
    know that.

### MVP user outcome

A user can run a scan, see a baseline, run another scan later, identify
the largest directory-level changes, inspect scan coverage, and
understand whether the result is complete.

### Market differentiation hypothesis

Existing disk analyzers show current usage; system monitors show
metrics. Change Detective aims to make **historical change detection and
evidence-led investigation** its central workflow.

This differentiation is a hypothesis, not a proven market gap. Validate
it with real users before investing in broader features.

------------------------------------------------------------------------

## 3. MVP scope

### Included

-   Windows-first, local web dashboard.
-   Node.js and TypeScript application code.
-   PostgreSQL installed natively on Windows for development.
-   Manual scans.
-   Scheduled scans while the local application/service is running.
-   Configurable monitored root path.
-   Disk total and free-space metrics where available.
-   Top-level directory listing with recursive size measurement of each
    child directory.
-   Snapshot history and comparison with the previous comparable
    successful scan.
-   Absolute byte changes and percentage changes.
-   Configurable low-free-space threshold.
-   Scan status, duration, and incomplete-coverage reporting.
-   Dashboard overview, scan history, largest changes, findings, and
    settings.
-   Database migrations and backup/restore documentation.
-   Automated tests for the scanner, comparison rules, and API.

### Explicitly out of scope for the first release

-   Malware detection or claims that a file is malicious.
-   Automatic cleanup or deletion.
-   Process termination or system modification.
-   AI-generated diagnosis or required LLM integration.
-   Remote monitoring and multi-device networking.
-   Hosted SaaS, billing, or multi-tenant authentication.
-   Android or macOS/Linux agents.
-   Docker/WSL resource integrations.
-   Network diagnostics, port-conflict detection, or service monitoring
    beyond basic application/database health.
-   Full desktop-shell packaging.

The schema can use a `devices` table from the beginning, but the MVP
only needs one local device.

------------------------------------------------------------------------

## 4. User workflow

### First run

1.  User starts the application.
2.  Application checks API and PostgreSQL connectivity.
3.  User selects or confirms the monitored root (initial default may be
    `C:\`, but it must be configurable).
4.  User reviews what will be measured and where data is stored.
5.  User starts the first scan.
6.  The first successful scan becomes the baseline. Do not show
    historical change claims for it.

### Manual scan

1.  User clicks **Scan now**.
2.  API creates a scan record with status `queued` or `running`.
3.  Scanner enumerates immediate child directories of the configured
    root.
4.  Scanner recursively walks each child directory and sums file sizes
    without loading the entire tree into memory.
5.  Scanner captures root disk capacity/free-space data when supported.
6.  Scanner records errors, inaccessible paths, start/end time, and
    coverage.
7.  Measurements and final status are persisted.
8.  Comparison service compares the result against the previous
    comparable successful scan.
9.  Findings are generated from deterministic rules.
10. Dashboard updates with status and results.

The HTTP request should return a scan ID promptly. The frontend polls
the scan-status endpoint; it should not hold one request open for the
entire filesystem traversal.

### Scheduled scan

-   Default interval: 360 minutes (6 hours), configurable.
-   Scheduled scans run only while the local scheduler process is
    running.
-   Do not create overlapping scans for the same root.
-   If the app restarts, resume future scheduling based on the saved
    setting. Do not silently invent missed snapshots.
-   Manual scans should be allowed even if the scheduler is disabled,
    provided no scan is already running for the same root.

### Investigation

The user can: - View the latest drive overview. - See the last scan's
time, status, duration, and coverage. - View the largest measured
directories. - Compare two comparable scans. - See absolute and
percentage changes. - Inspect warnings and their supporting evidence. -
Open the affected directory in File Explorer when feasible and safe. -
Run another scan to verify whether a change persists.

### Error workflow

-   Access denied: record incomplete coverage and continue elsewhere
    when possible.
-   Root unavailable: fail the scan with a clear message.
-   Database unavailable: show an error; do not silently discard
    results.
-   Process interrupted: do not mark the scan as completed.
-   Incomplete directory measurement: never treat the path as deleted or
    zero bytes.
-   First scan: baseline only.
-   No comparable previous scan: explain that change detection is not
    yet available.

------------------------------------------------------------------------

## 5. Key terminology and measurement semantics

-   **Root:** The configured drive or directory being monitored, such as
    `C:\`.
-   **Top-level directory:** An immediate child directory of the root.
    These are the rows displayed in the MVP.
-   **Recursive measurement:** The scanner traverses descendants to
    calculate the aggregate size of a top-level directory. "Top-level
    first" is a display/aggregation choice, not a promise that only one
    filesystem level is read.
-   **Snapshot:** Measurements captured during one scan.
-   **Comparable scan:** A completed or otherwise safely comparable scan
    for the same device, normalized root, and measurement semantics.
-   **Baseline:** The first successful scan for a monitored root.
-   **Incomplete measurement:** The scanner could not confidently
    measure the entire directory, for example due to access errors.
-   **Finding:** A user-visible warning or notable event backed by
    evidence.
-   **Observed change:** A difference between measurements. It does not
    necessarily identify the action or person that caused it.

### Accuracy rules

1.  Compare only the same normalized path under the same monitored root.
2.  Do not interpret inaccessible paths as deleted.
3.  Do not report an exact change if either measurement is incomplete;
    show an uncertainty/incomplete-coverage state instead.
4.  Use a stable path normalization strategy appropriate for Windows,
    including case-insensitive comparison while preserving a display
    path.
5.  Do not follow junctions or symbolic links by default. Avoid cycles
    and double-counting.
6.  Account for files that disappear during scanning; capture errors and
    mark coverage appropriately.
7.  Avoid claiming directory totals equal the whole drive's used space.
    Filesystem overhead, protected paths, inaccessible directories, and
    measurement semantics can cause differences.
8.  A file's logical size is not necessarily the same as allocated disk
    space. State which measure is being used. Initial implementation can
    sum file logical sizes.
9.  Use byte integers internally. PostgreSQL `BIGINT` values may exceed
    JavaScript's safe integer range. In Node.js, handle them as strings
    or `bigint`, and serialize them as decimal strings. Never silently
    round.
10. Percentage change is undefined when the previous size is zero;
    present the absolute change and a "newly observed" label instead of
    dividing by zero.
11. If a path is new or missing, distinguish actual presence/absence
    from scan coverage. A missing row is not sufficient evidence of
    deletion when a scan is incomplete.

------------------------------------------------------------------------

## 6. Dashboard requirements

### A. Overview

Show: - Monitored root. - Drive total bytes and free bytes, where
available. - Used percentage, clearly labelled as drive-level data. -
Last scan status and timestamp. - Current scan progress/status. - Count
of incomplete directories. - Low-space warning if the configured
threshold is crossed. - Primary action: **Scan now**. - Links/actions
for directory changes, scan history, and settings.

States: - **Healthy:** configured checks completed and no configured
threshold was crossed. - **Warning:** a defined threshold was crossed or
a notable measured change was detected. - **Unknown:** insufficient
data, failed scan, missing permissions, or stale measurements. Do not
invent a single AI-generated health score.

### B. Directory view

Show immediate child directories of the selected root, with: - Display
path/name. - Measured logical size. - Completeness indicator. - Size
change compared with selected previous scan. - Percentage change when
mathematically valid. - Sort by size or growth. - Clear
empty/loading/error states.

### C. Scan history

Show: - Scan ID or shortened identifier. - Trigger type (`manual` or
`scheduled`). - Started/completed time. - Status. - Duration. - Number
of directories measured and number with errors.

### D. Finding detail

Show: - Title, severity, timestamp, root, and scan reference. - The
exact rule that triggered the finding. - Evidence values and measurement
timestamps. - Caveat when data is incomplete. - Safe next steps. - No
unsupported claim about the root cause.

### E. Settings

Allow configuration of: - Monitored root. - Scan interval (minimum 15
minutes, maximum 10,080 minutes / 7 days). - Low-free-space threshold
percentage (0--100). - History retention (1--3650 days). Validate all
settings on the server. Root changes should be explicit and create a new
comparison lineage; do not compare unrelated roots.

------------------------------------------------------------------------

## 7. Recommended architecture and stack

### Runtime

-   Windows development machine.
-   Supported Node.js LTS release.
-   npm workspaces.
-   TypeScript with strict mode.
-   PostgreSQL installed directly as a Windows service.
-   No Docker in the development workflow.

### Applications/packages

-   `apps/api`: Fastify + TypeScript; local REST API, scheduler,
    database access.
-   `apps/web`: Next.js + TypeScript; local browser dashboard.
-   `packages/scanner`: isolated Windows filesystem scanner, testable
    without API/database.
-   `packages/shared`: optional shared API types and schemas if needed.
-   `db/migrations`: versioned SQL migrations.
-   `scripts`: development/maintenance scripts.

### Libraries (choose compatible stable versions and document versions)

-   Fastify for API.
-   Zod for request/config validation.
-   `pg` or Prisma for PostgreSQL access. Prefer the simplest fit; if
    using Prisma, keep migrations committed and review generated SQL.
-   SQL migrations through Prisma Migrate or a lightweight migration
    tool. Do not mix competing migration systems.
-   Recharts or another permissively licensed chart library for
    dashboard graphs.
-   Vitest or Node's built-in test runner for tests.
-   ESLint and Prettier, if desired, for consistency.

Do not add Redis, queues, Kubernetes, Prometheus, an LLM, or other
infrastructure until a measured need exists.

### Network/security

-   Bind API to `127.0.0.1` in local MVP mode.
-   Do not bind to all interfaces by default.
-   Do not expose the API to the LAN or internet without a deliberate
    authentication and security design.
-   The browser talks to the API; it never connects directly to
    PostgreSQL.
-   Database credentials stay in server-side environment variables.
-   Do not expose arbitrary filesystem scanning through an unrestricted
    API parameter.
-   Validate requested roots against configured/allowed roots.
-   Use parameterized SQL or a safe ORM.
-   Avoid logging sensitive paths or environment details unnecessarily.
-   No telemetry is sent off-device by default.

------------------------------------------------------------------------

## 8. Suggested repository structure

``` text
change-detective/
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── routes/
│   │       ├── services/
│   │       ├── scheduler/
│   │       ├── plugins/
│   │       └── server.ts
│   └── web/
│       └── src/
│           ├── app/
│           ├── components/
│           └── lib/
├── packages/
│   ├── scanner/
│   │   └── src/
│   │       ├── windows/
│   │       ├── scanner.ts
│   │       └── types.ts
│   └── shared/
├── db/
│   └── migrations/
├── scripts/
├── tests/
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.base.json
└── README.md
```

Avoid creating empty abstractions for every future feature. Keep modules
small and add packages only when a real boundary exists.

------------------------------------------------------------------------

## 9. PostgreSQL schema proposal

This is an initial logical schema. Implement it using versioned
migrations, UUIDs, foreign keys, constraints, and useful indexes. Review
names/types before applying migrations.

``` sql
CREATE TABLE devices (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    os_name TEXT NOT NULL DEFAULT 'Windows',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ
);

CREATE TABLE settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    monitored_root TEXT NOT NULL DEFAULT 'C:\\',
    scan_interval_minutes INTEGER NOT NULL DEFAULT 360
        CHECK (scan_interval_minutes BETWEEN 15 AND 10080),
    low_space_threshold_percent NUMERIC(5,2) NOT NULL DEFAULT 10
        CHECK (low_space_threshold_percent BETWEEN 0 AND 100),
    history_retention_days INTEGER NOT NULL DEFAULT 90
        CHECK (history_retention_days BETWEEN 1 AND 3650),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE scans (
    id UUID PRIMARY KEY,
    device_id UUID NOT NULL REFERENCES devices(id),
    root_path TEXT NOT NULL,
    trigger_type TEXT NOT NULL
        CHECK (trigger_type IN ('manual', 'scheduled')),
    status TEXT NOT NULL
        CHECK (status IN (
            'queued', 'running', 'completed',
            'partial', 'failed', 'cancelled'
        )),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    total_bytes BIGINT,
    free_bytes BIGINT,
    scanned_directory_count INTEGER NOT NULL DEFAULT 0,
    inaccessible_directory_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
);

CREATE INDEX scans_device_started_idx
    ON scans (device_id, started_at DESC);

CREATE TABLE directory_snapshots (
    scan_id UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    normalized_path TEXT NOT NULL,
    display_name TEXT NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    files_count BIGINT,
    directories_count BIGINT,
    measurement_complete BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (scan_id, normalized_path)
);

CREATE TABLE findings (
    id UUID PRIMARY KEY,
    device_id UUID NOT NULL REFERENCES devices(id),
    scan_id UUID REFERENCES scans(id) ON DELETE SET NULL,
    finding_type TEXT NOT NULL,
    severity TEXT NOT NULL
        CHECK (severity IN ('info', 'warning', 'critical')),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX findings_device_created_idx
    ON findings (device_id, created_at DESC);

INSERT INTO settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;
```

### Schema notes

-   Insert a single local `devices` row during initialization, using a
    stable locally generated UUID stored in local configuration.
-   The settings table intentionally holds one local configuration row
    in the MVP.
-   A scan stores root-level drive capacity/free-space data when
    available.
-   `directory_snapshots` stores one aggregate measurement per top-level
    child directory per scan.
-   Store error/coverage details at an appropriate level. If useful, add
    a `scan_errors` table rather than packing a large list into one
    string.
-   `findings.evidence` should be structured JSON with explicit values,
    scan IDs, comparison values, and rule identifiers.
-   Add a migration/version table if not supplied by the chosen
    migration tool.
-   Consider storing root identity/normalized root separately if the
    product expands to multiple monitored roots. Do not compare
    different roots.
-   Ensure the application can recover scans left in `running` after a
    crash: mark them failed/interrupted during startup recovery rather
    than treating them as completed.
-   Avoid deleting scans that are referenced by findings unless
    retention behavior deliberately handles those references.

------------------------------------------------------------------------

## 10. API contract

Use `/api` as the API prefix. Validate input and output with typed
schemas.

  --------------------------------------------------------------------------------
  Method                  Endpoint                       Purpose
  ----------------------- ------------------------------ -------------------------
  `GET`                   `/api/health`                  API/database health check

  `GET`                   `/api/devices`                 List local devices

  `GET`                   `/api/scans`                   List recent scans

  `POST`                  `/api/scans`                   Start a manual scan;
                                                         return scan ID

  `GET`                   `/api/scans/:id`               Get status and scan
                                                         summary

  `GET`                   `/api/scans/:id/directories`   Return directory
                                                         measurements

  `GET`                   `/api/scans/:id/changes`       Compare with previous
                                                         comparable scan

  `GET`                   `/api/findings`                List findings

  `GET`                   `/api/settings`                Get current settings

  `PATCH`                 `/api/settings`                Update
                                                         interval/threshold/root
                                                         settings
  --------------------------------------------------------------------------------

### API behavior

-   `POST /api/scans` returns promptly, for example `202 Accepted` with
    the scan ID and initial status.
-   Frontend polls `GET /api/scans/:id` while the scan runs.
-   Return consistent error payloads with a stable error code and safe
    human-readable message.
-   Reject a scan if another scan for the same root is running, or
    return the existing scan ID.
-   Use pagination/limits for history endpoints as data grows.
-   Do not let clients submit arbitrary filesystem paths without
    server-side allowlist/configuration checks.
-   `/api/health` should distinguish API availability from database
    availability.

------------------------------------------------------------------------

## 11. Scanner implementation requirements

The scanner is the most important technical risk. Build and test it
before the dashboard.

### Inputs

-   Configured root path.
-   Cancellation signal.
-   Optional progress callback.
-   Scan metadata such as scan ID and trigger type.

### Output

A structured result containing: - Root path. - Start and completion
timestamps. - Top-level child directory measurements. - Size in bytes,
serialized as a decimal string at JSON boundaries. - Number of
files/directories observed if supported. - Completeness flag. - Error
count and safe error details. - Overall scan status. - Duration.

### Algorithm

1.  Validate that the configured root exists and is a directory.
2.  Capture root disk capacity/free-space metrics using a supported
    Windows API or a carefully invoked, safely parameterized PowerShell
    command. Keep this adapter isolated.
3.  Enumerate immediate child directories.
4.  For each child directory, traverse descendants incrementally.
5.  Sum file logical sizes using `bigint` internally.
6.  Do not follow junctions or symbolic links by default. Detect reparse
    points appropriately on Windows.
7.  Catch access errors and file disappearance; continue where safe and
    mark affected measurement incomplete.
8.  Support cancellation and progress reporting.
9.  Avoid keeping all file paths or a complete tree in memory.
10. Return a deterministic result for tests.
11. Persist results transactionally where practical.
12. Mark a scan `partial` if relevant measurements are incomplete,
    `failed` if the root cannot be measured, and `completed` only if the
    required coverage is complete.

### Important implementation caveats

-   Node.js `Dirent` and symlink behavior alone may not fully
    distinguish every Windows reparse-point type. Investigate and test
    Windows junction handling; use a dedicated Windows adapter if
    needed.
-   Directory sizes are computed by traversing descendants, which can be
    slow on large trees. Start sequentially and optimize only after
    measurement.
-   The scanner should not read file contents or compute hashes.
-   Exclude no directories silently. If the product has default
    exclusions later, show them to the user and document why.
-   Avoid counting the same data twice due to links or junctions.
-   Root-level free space and the sum of directory logical sizes are
    different measurements.

### Scanner test cases

-   Empty root.
-   Single file.
-   Nested directories.
-   Known sizes and expected sums.
-   Zero-byte file.
-   Unicode and whitespace in path names.
-   Access-denied directory (test where practical).
-   File removed during scan.
-   Symlink/junction handling.
-   Cancellation.
-   Large number of entries with bounded memory.
-   Two scans showing a known increase/decrease.
-   Incomplete scan must not create a false deletion finding.

------------------------------------------------------------------------

## 12. Comparison and findings rules

### Comparison algorithm

1.  Find the previous comparable scan for the same device and normalized
    root.
2.  Require both scans to have usable measurements for the path.
3.  Match directories using normalized, case-insensitive Windows paths
    while preserving a display path.
4.  Compute `deltaBytes = currentBytes - previousBytes`.
5.  Compute percentage change only when previous bytes are greater than
    zero.
6.  If previous bytes are zero and current bytes are positive, label it
    as newly observed; do not divide by zero.
7.  If either measurement is incomplete, show the comparison as
    incomplete rather than exact.
8.  If a path is missing in one scan, only treat it as absent when the
    relevant scan coverage supports that conclusion.
9.  Sort largest positive changes first; allow sorting by size and
    absolute change.
10. Never claim the scan identifies the process/user/action that caused
    a change.

### Initial deterministic findings

-   Low free space: `free_bytes / total_bytes * 100` is below the
    configured threshold.
-   Significant growth: a directory's measured increase exceeds a
    configurable or initially fixed threshold. Pick a conservative
    initial rule and document it.
-   Incomplete scan: one or more directories could not be fully
    measured.
-   Scan failed/interrupted: the scan did not complete as expected.

Do not add an arbitrary overall "AI health score." Every warning must
explain the rule and the values that triggered it.

------------------------------------------------------------------------

## 13. Scheduler and reliability

-   Initial default interval: six hours.
-   Minimum interval: 15 minutes; maximum: seven days.
-   Scheduler runs in the API process for the MVP.
-   Prevent overlapping scans for the same root.
-   Use a single-flight lock or database-backed guard so manual and
    scheduled triggers cannot run concurrently for the same root.
-   Save the scan record before work begins.
-   Save progress/status where feasible.
-   On startup, detect stale `running` scans and mark them
    interrupted/failed with an explanation.
-   If the app is not running, scheduled scans do not occur. Explain
    this in the UI.
-   Avoid an unbounded in-memory job queue.
-   Make scan execution cancellable.
-   Retention cleanup must be explicit, configurable, and safe; never
    delete all history by default.
-   Add a backup/restore guide for PostgreSQL.

------------------------------------------------------------------------

## 14. Security, privacy, and safety

-   Bind the API to `127.0.0.1` by default.
-   Never expose PostgreSQL directly to the browser.
-   Keep secrets in environment variables and `.env` (never commit
    `.env`).
-   Commit `.env.example` with placeholders only.
-   Use parameterized queries or a safe ORM.
-   Validate and normalize all configured paths.
-   Do not permit arbitrary client-controlled paths to escape the
    configured root.
-   Do not upload telemetry or scan data to third parties.
-   Avoid collecting file contents, hashes, or command-line arguments.
-   Do not delete or modify files.
-   Open File Explorer only after a deliberate user action, and pass
    paths safely.
-   Document the limits of disk-usage measurement and permission errors.
-   Add a clear way to pause scheduled scanning and delete local
    history.
-   Treat all directory names and filesystem metadata as untrusted data
    when rendering UI.

------------------------------------------------------------------------

## 15. UI states and visual design

Build a clean, restrained, developer-oriented interface. Avoid
decorative complexity in the first release.

Required states: - First-run/onboarding. - No baseline yet. - Scan
queued/running with progress. - Scan completed. - Scan partially
completed. - Scan failed. - Database unavailable. - No historical
changes yet. - Low disk space warning. - Incomplete coverage warning. -
Empty directory list. - Settings validation error.

Keep warning labels meaningful and neutral. Do not use green/red as the
only way to communicate status; include text/icons.

------------------------------------------------------------------------

## 16. Zero-cost development and deployment model

### Development

-   Node.js and npm installed locally.
-   PostgreSQL installed natively on Windows.
-   Next.js and Fastify run in separate local processes.
-   No Docker required.
-   No paid API, hosted database, or AI service.

### MVP user deployment

Initially, document developer-style local setup. Later, provide a
Windows installer or script that starts the API and dashboard and opens
the local web UI. Installer packaging is not a prerequisite for the
first functional prototype.

### Future options

-   Local mode: agent/API/database/dashboard on the same computer.
-   Self-hosted mode: dashboard/API/PostgreSQL on a user-controlled
    machine and agents reporting securely.
-   Hosted service: optional future product that incurs real operating
    costs and is not required for the open-source edition.

Do not build remote access in the MVP. Remote agents require
authentication, TLS, agent enrollment, authorization, update/security
strategy, and careful privacy design.

------------------------------------------------------------------------

## 17. Testing and definition of done

### MVP acceptance checklist

-   [ ] PostgreSQL starts natively on Windows and migrations apply
    cleanly.
-   [ ] API health endpoint reports API and database status accurately.
-   [ ] Scanner measures a controlled test directory correctly.
-   [ ] Scanner does not load the entire directory tree into memory.
-   [ ] Junctions/symlinks are not followed by default.
-   [ ] Permission errors produce incomplete status, not false zero
    sizes.
-   [ ] First scan establishes a baseline without change alerts.
-   [ ] Second scan reports known growth/shrinkage accurately.
-   [ ] Big integer byte values do not silently lose precision.
-   [ ] Manual scan starts asynchronously and exposes status.
-   [ ] Scheduled scan respects settings and prevents overlap.
-   [ ] Failed/interrupted scans are recoverable and visible.
-   [ ] Dashboard supports overview, history, directory changes,
    findings and settings.
-   [ ] No telemetry is sent externally.
-   [ ] Tests cover scanner, comparison logic, API validation, and
    critical UI states.
-   [ ] README documents setup, configuration, tests, migration, backup,
    limitations and troubleshooting.
-   [ ] A fresh checkout can be set up by following the README.

### Suggested commands (adapt to the final package scripts)

-   `npm install`
-   `npm run typecheck`
-   `npm test`
-   `npm run dev`

Do not claim these commands work until they are actually configured and
tested.

------------------------------------------------------------------------

## 18. Implementation sequence

### Phase 0 --- Environment and project foundation

1.  Verify Node.js and PostgreSQL versions.
2.  Create npm workspace.
3.  Configure strict TypeScript and lint/test commands.
4.  Add `.gitignore` and `.env.example`.
5.  Connect to PostgreSQL.
6.  Add migrations and seed one local device/settings row. **Exit
    criterion:** API health endpoint successfully checks the database.

### Phase 1 --- Scanner

1.  Define scanner input/output types.
2.  Implement root validation and directory enumeration.
3.  Implement streaming recursive size calculation.
4.  Implement cancellation, progress, and error coverage.
5.  Add controlled filesystem tests. **Exit criterion:** scanner returns
    correct results for a test fixture.

### Phase 2 --- Persistence and comparison

1.  Create scan service and transaction boundaries.
2.  Persist scan and directory snapshots.
3.  Implement previous-comparable-scan selection.
4.  Implement delta and completeness semantics.
5.  Generate deterministic findings. **Exit criterion:** two scans
    produce accurate change records/results.

### Phase 3 --- API

1.  Add health endpoint.
2.  Add scan creation/status endpoints.
3.  Add history/directory/change/findings endpoints.
4.  Add settings endpoints.
5.  Validate all inputs and implement scan concurrency control. **Exit
    criterion:** all core functionality is accessible through the API.

### Phase 4 --- Dashboard

1.  Implement app shell and overview.
2.  Add scan-now flow and polling.
3.  Add directory list and sorting.
4.  Add scan history and change view.
5.  Add findings and settings.
6.  Add loading, empty, partial and failure states. **Exit criterion:**
    complete end-to-end local workflow.

### Phase 5 --- Scheduled operation and polish

1.  Implement configurable scheduler.
2.  Recover stale scans on startup.
3.  Add retention and safe backup/restore documentation.
4.  Test restart behavior and resource usage.
5.  Improve README and local setup. **Exit criterion:** reliable local
    use over multiple days.

------------------------------------------------------------------------

## 19. First coding task for the agent

**Task 001: Implement the isolated Windows top-level directory scanner.
Do not build the dashboard yet.**

Create: - `packages/scanner/src/types.ts` -
`packages/scanner/src/scanner.ts` - `packages/scanner/src/windows/` for
Windows-specific filesystem behavior if required - scanner tests under
the package's test directory

Requirements: 1. Accept a configured root path and optional cancellation
signal/progress callback. 2. Validate that the root exists and is a
directory. 3. Enumerate immediate child directories. 4. Recursively
measure each child directory using incremental traversal. 5. Sum logical
file sizes with `bigint`. 6. Serialize byte counts as decimal strings at
JSON boundaries. 7. Do not follow symlinks/junctions by default; verify
Windows reparse-point handling rather than assuming ordinary symlink
checks cover every case. 8. Handle permission failures and file
disappearance without crashing the entire scan. 9. Mark a measurement
incomplete if any part of that directory could not be measured. 10.
Record start/end times, duration, error count, and overall coverage. 11.
Never read file contents or calculate hashes. 12. Include deterministic
tests with temporary folders and known file sizes. 13. Do not add
PostgreSQL/API/dashboard dependencies to the scanner package. 14. Do not
implement deletion, cleanup, AI, remote communication, or arbitrary scan
paths from an HTTP request.

### Expected first output

The coding agent should first inspect the existing repository and
environment, then implement this task in small steps, run the tests,
report changed files and actual test results, and document any
Windows-specific limitations. It must not claim tests passed if they
were not run.

------------------------------------------------------------------------

## 20. Instructions to the coding agent

Treat this document as the source of truth for product scope and
intended behavior.

Before writing or changing code: 1. Inspect the repository and existing
implementation. 2. Identify what already exists; do not overwrite
working code unnecessarily. 3. Report a concise implementation plan for
the current phase. 4. Implement only the next logical phase unless
explicitly asked to continue. 5. Keep scope aligned with the MVP and
avoid premature infrastructure. 6. Prefer small, testable functions and
explicit types. 7. Use migrations for database changes. 8. Run
tests/type checks and report actual outcomes. 9. Explain assumptions and
unresolved trade-offs. 10. Update README and relevant documentation when
behavior changes. 11. Never add paid dependencies, cloud services,
telemetry, or external APIs without explicit approval. 12. Do not expose
the local API to the network or introduce destructive actions without
explicit approval.

When a technical detail is uncertain, investigate it and state the
trade-off instead of fabricating certainty.

**First action:** implement Task 001, the scanner package, and prove its
behavior with automated tests.
