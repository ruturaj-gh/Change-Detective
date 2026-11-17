/**
 * Scheduler — Phase 5.
 *
 * Runs periodic scans while the API process is alive.
 * - Single-flight: will not start a new scan if one is already running.
 * - Reads interval from the database settings on each tick.
 * - Never silently invents missed snapshots.
 * - Documented: scheduled scans only occur while this process is running.
 */
import { startScan } from "../services/scan.service.js";
import { prisma } from "../db/client.js";

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;
const lastScheduledAt = new Map<string, number>();
let lastRetentionCleanupAt = 0;

/**
 * Start the scheduler loop.
 * Will run until `stopScheduler()` is called.
 */
export function startScheduler(): void {
  stopped = false;
  console.log("[scheduler] Started.");
  scheduleNextTick();
}

/**
 * Stop the scheduler (e.g., on graceful shutdown).
 */
export function stopScheduler(): void {
  stopped = true;
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
  console.log("[scheduler] Stopped.");
}

async function scheduleNextTick(): Promise<void> {
  if (stopped) return;

  try {
    const settings = await prisma.settings.findMany({
      select: {
        userId: true,
        scanIntervalMinutes: true,
        historyRetentionDays: true,
        user: { select: { devices: { select: { id: true, agentTokenHash: true } } } },
      },
    });
    const now = Date.now();
    if (now - lastRetentionCleanupAt >= 6 * 60 * 60 * 1000) {
      for (const accountSettings of settings) {
        const deviceIds = accountSettings.user.devices.map((device) => device.id);
        if (deviceIds.length === 0) continue;
        const cutoff = new Date(
          now - accountSettings.historyRetentionDays * 24 * 60 * 60 * 1000
        );
        await prisma.$transaction([
          prisma.finding.deleteMany({
            where: { deviceId: { in: deviceIds }, createdAt: { lt: cutoff } },
          }),
          prisma.scan.deleteMany({
            where: {
              deviceId: { in: deviceIds },
              completedAt: { lt: cutoff },
            },
          }),
        ]);
      }
      lastRetentionCleanupAt = now;
    }

    for (const accountSettings of settings) {
      const intervalMs = accountSettings.scanIntervalMinutes * 60 * 1000;
      const previousTick = lastScheduledAt.get(accountSettings.userId) ?? now;
      if (now - previousTick < intervalMs) continue;

      const devices = accountSettings.user.devices.filter((device) =>
        process.env["SCAN_MODE"] === "agent"
          ? device.agentTokenHash !== null
          : device.agentTokenHash === null
      );
      for (const device of devices) {
        try {
          const result = await startScan(
            accountSettings.userId,
            "scheduled",
            device.id
          );
          if (result.status === "already_running") {
            console.log(
              `[scheduler] Account ${accountSettings.userId} already has scan ${result.existingScanId}; skipping device ${device.id}.`
            );
          }
        } catch (error) {
          console.error(
            `[scheduler] Failed to schedule scan for device ${device.id}:`,
            error
          );
        }
      }
      lastScheduledAt.set(accountSettings.userId, now);
    }
  } catch (err) {
    console.error("[scheduler] Failed to schedule account scans:", err);
  }

  if (!stopped) {
    schedulerTimer = setTimeout(() => void scheduleNextTick(), 60 * 1000);
  }
}

