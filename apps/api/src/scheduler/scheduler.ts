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
import { getSettings } from "../services/settings.service.js";

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;

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

  let intervalMs: number;
  try {
    const settings = await getSettings();
    intervalMs = settings.scanIntervalMinutes * 60 * 1000;
  } catch (err) {
    console.error("[scheduler] Failed to read settings, retrying in 1 minute:", err);
    intervalMs = 60 * 1000;
  }

  schedulerTimer = setTimeout(async () => {
    if (stopped) return;

    console.log("[scheduler] Triggering scheduled scan.");
    try {
      const result = await startScan("scheduled");
      if (result.status === "already_running") {
        console.log(`[scheduler] Scan already running (id: ${result.existingScanId}), skipping.`);
      } else {
        console.log(`[scheduler] Scan started (id: ${result.scanId}).`);
      }
    } catch (err) {
      console.error("[scheduler] Failed to start scheduled scan:", err);
    }

    // Schedule next tick.
    scheduleNextTick();
  }, intervalMs);
}

