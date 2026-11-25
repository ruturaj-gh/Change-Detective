import Database from "better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const MAX_PENDING_SCANS = 500;
const MAX_PENDING_BYTES = 100 * 1024 * 1024;
const SCAN_RESULT_HEADROOM_BYTES = 12 * 1024 * 1024;

const PendingScanSchema = z.object({
  scanId: z.string().uuid(),
  source: z.enum(["task", "local"]),
  triggerType: z.enum(["manual", "scheduled", "event"]),
  result: z.record(z.unknown()),
  createdAt: z.string().datetime(),
}).superRefine((scan, context) => {
  if (
    (scan.source === "local" && scan.triggerType === "manual") ||
    (scan.source === "task" && scan.triggerType === "event")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["triggerType"],
      message: "The scan source and trigger type do not match.",
    });
  }
});

export type PendingScan = z.infer<typeof PendingScanSchema>;

interface QueueStats {
  count: number;
  bytes: number;
}

export class PendingQueueFullError extends Error {
  constructor() {
    super("The local scan queue is full; pending results were not discarded.");
    this.name = "PendingQueueFullError";
  }
}

export class LocalAgentStore {
  private readonly database: Database.Database;
  private readonly readQueueStats: Database.Statement;
  private readonly insertPending: Database.Statement;
  private readonly readPending: Database.Statement;
  private readonly deletePending: Database.Statement;
  private readonly readState: Database.Statement;
  private readonly writeState: Database.Statement;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") chmodSync(directory, 0o700);

    this.database = new Database(join(directory, "agent.sqlite"));
    if (process.platform !== "win32") {
      chmodSync(join(directory, "agent.sqlite"), 0o600);
    }
    this.database.pragma("journal_mode = DELETE");
    this.database.pragma("synchronous = FULL");
    this.database.pragma("busy_timeout = 5000");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS pending_scans (
        scan_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        result_json TEXT NOT NULL,
        payload_bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    this.readQueueStats = this.database.prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(payload_bytes), 0) AS bytes
       FROM pending_scans`
    );
    this.insertPending = this.database.prepare(
      `INSERT INTO pending_scans
       (scan_id, source, trigger_type, result_json, payload_bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    this.readPending = this.database.prepare(
      `SELECT scan_id AS scanId, source, trigger_type AS triggerType,
              result_json AS resultJson, created_at AS createdAt
       FROM pending_scans ORDER BY created_at ASC, scan_id ASC`
    );
    this.deletePending = this.database.prepare(
      "DELETE FROM pending_scans WHERE scan_id = ?"
    );
    this.readState = this.database.prepare(
      "SELECT value FROM agent_state WHERE key = ?"
    );
    this.writeState = this.database.prepare(
      `INSERT INTO agent_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
  }

  hasCapacityForScan(): boolean {
    const stats = this.readQueueStats.get() as QueueStats;
    return (
      stats.count < MAX_PENDING_SCANS &&
      stats.bytes < MAX_PENDING_BYTES - SCAN_RESULT_HEADROOM_BYTES
    );
  }

  enqueue(scan: PendingScan, nextScheduledAt?: number): void {
    const parsed = PendingScanSchema.parse(scan);
    const resultJson = JSON.stringify(parsed.result);
    const payloadBytes = Buffer.byteLength(resultJson, "utf8");
    const transaction = this.database.transaction(() => {
      const stats = this.readQueueStats.get() as QueueStats;
      const existing = this.database
        .prepare(
          `SELECT source, trigger_type, result_json
           FROM pending_scans WHERE scan_id = ?`
        )
        .get(parsed.scanId) as
        | { source: string; trigger_type: string; result_json: string }
        | undefined;
      if (existing) {
        if (
          existing.source !== parsed.source ||
          existing.trigger_type !== parsed.triggerType ||
          existing.result_json !== resultJson
        ) {
          throw new Error("A queued scan ID cannot be reused with different results.");
        }
        return;
      }
      if (
        stats.count >= MAX_PENDING_SCANS ||
        stats.bytes + payloadBytes > MAX_PENDING_BYTES
      ) {
        throw new PendingQueueFullError();
      }
      this.insertPending.run(
        parsed.scanId,
        parsed.source,
        parsed.triggerType,
        resultJson,
        payloadBytes,
        parsed.createdAt
      );
      if (nextScheduledAt !== undefined) {
        this.writeState.run("nextScheduledAt", String(nextScheduledAt));
      }
    });
    transaction();
  }

  listPending(): PendingScan[] {
    const rows = this.readPending.all() as Array<{
      scanId: string;
      source: string;
      triggerType: string;
      resultJson: string;
      createdAt: string;
    }>;
    return rows.map((row) =>
      PendingScanSchema.parse({
        scanId: row.scanId,
        source: row.source,
        triggerType: row.triggerType,
        result: JSON.parse(row.resultJson) as unknown,
        createdAt: row.createdAt,
      })
    );
  }

  removePending(scanId: string): void {
    this.deletePending.run(scanId);
  }

  getScanIntervalMinutes(): number | null {
    const row = this.readState.get("scanIntervalMinutes") as
      | { value: string }
      | undefined;
    if (!row) return null;
    const value = Number(row.value);
    if (!Number.isInteger(value) || value < 15 || value > 10080) {
      throw new Error("The saved agent scan interval is invalid.");
    }
    return value;
  }

  setScanIntervalMinutes(minutes: number): void {
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 10080) {
      throw new Error("The agent scan interval is outside the supported range.");
    }
    this.writeState.run("scanIntervalMinutes", String(minutes));
  }

  getNextScheduledAt(): number | null {
    const row = this.readState.get("nextScheduledAt") as
      | { value: string }
      | undefined;
    if (!row) return null;
    const value = Number(row.value);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error("The saved next scan time is invalid.");
    }
    return value;
  }

  setNextScheduledAt(timestamp: number): void {
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      throw new Error("The next scheduled scan time is invalid.");
    }
    this.writeState.run("nextScheduledAt", String(timestamp));
  }

  close(): void {
    this.database.close();
  }
}
