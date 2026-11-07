/**
 * Scan service — Phase 2.
 *
 * Orchestrates:
 * 1. Creating a scan record in the database.
 * 2. Running the scanner package.
 * 3. Persisting directory snapshots.
 * 4. Running comparison against the previous comparable scan.
 * 5. Generating deterministic findings.
 * 6. Recovering stale "running" scans on startup.
 */
import { prisma } from "../db/client.js";
import { scan as runScanner } from "@change-detective/scanner";
import type { ScanResult, ScanProgress, DirectoryMeasurement } from "@change-detective/scanner";
import { normalizePath } from "@change-detective/scanner";
import { generateFindings } from "./findings.service.js";
import { getOrCreateDeviceId } from "../config/device-id.js";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// In-process concurrency guard: one scan per normalized root path.
// ---------------------------------------------------------------------------
const runningScanRoots = new Set<string>();

export interface StartScanResult {
  scanId: string;
  status: "queued" | "already_running";
  existingScanId?: string | undefined;
}

/**
 * Starts a manual scan asynchronously.
 * Returns the scan ID immediately (202-style) and runs the scan in the background.
 */
export async function startScan(
  triggerType: "manual" | "scheduled"
): Promise<StartScanResult> {
  const deviceId = await getOrCreateDeviceId();
  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
  const rootPath = settings.monitoredRoot;
  const normalizedRoot = normalizePath(rootPath);

  // Concurrency check — prevent overlapping scans for the same root.
  if (runningScanRoots.has(normalizedRoot)) {
    // Find the current running scan ID for the response.
    const existingScan = await prisma.scan.findFirst({
      where: {
        deviceId,
        rootPath: normalizedRoot,
        status: { in: ["queued", "running"] },
      },
      orderBy: { startedAt: "desc" },
      select: { id: true },
    });
    return {
      scanId: existingScan?.id ?? "unknown",
      status: "already_running" as const,
      existingScanId: existingScan?.id ?? undefined,
    };
  }

  const scanId = randomUUID();

  // Create the scan record with status "queued" BEFORE starting the work.
  await prisma.scan.create({
    data: {
      id: scanId,
      deviceId,
      rootPath: normalizedRoot,
      triggerType,
      status: "queued",
    },
  });

  // Fire and forget — do NOT await this.
  void executeScan(scanId, deviceId, normalizedRoot, settings.lowSpaceThresholdPercent.toString());

  return { scanId, status: "queued" };
}

/**
 * Executes the scan, persists results, runs comparison, and generates findings.
 * Called asynchronously from startScan — errors are captured in the scan record.
 */
async function executeScan(
  scanId: string,
  deviceId: string,
  rootPath: string,
  lowSpaceThresholdPercent: string
): Promise<void> {
  runningScanRoots.add(rootPath);

  // Mark running.
  await prisma.scan.update({
    where: { id: scanId },
    data: { status: "running" },
  });

  let scanResult: ScanResult;
  const controller = new AbortController();
  let progressWrites = Promise.resolve();
  // Store controller for potential future cancellation endpoint.
  activeScanControllers.set(scanId, controller);

  try {
    scanResult = await runScanner({
      rootPath,
      signal: controller.signal,
      meta: { scanId, triggerType: "manual" },
      onProgress: (progress: ScanProgress) => {
        // Persist occasional checkpoints so clients can show measured work
        // without inventing a percentage for an unknown scan duration.
        if (progress.completedDirectories % 5 !== 0 && progress.completedDirectories !== progress.totalDirectories) {
          return;
        }
        progressWrites = progressWrites
          .then(() => prisma.scan.update({
            where: { id: scanId },
            data: { scannedDirectoryCount: progress.completedDirectories },
          }))
          .then(() => undefined)
          .catch((err: unknown) => {
            console.warn(`[scan] Could not persist progress for ${scanId}:`, err);
          });
      },
    });
    await progressWrites;
  } catch (err) {
    await progressWrites;
    // Unexpected error from the scanner itself (should be rare).
    await prisma.scan.update({
      where: { id: scanId },
      data: {
        status: "failed",
        completedAt: new Date(),
        errorMessage:
          err instanceof Error ? err.message : "Unexpected scanner error.",
      },
    });
    activeScanControllers.delete(scanId);
    runningScanRoots.delete(rootPath);
    return;
  }

  activeScanControllers.delete(scanId);

  // Persist in a transaction.
  await prisma.$transaction(async (tx) => {
    // Update scan record.
    await tx.scan.update({
      where: { id: scanId },
      data: {
        status: scanResult.status,
        completedAt: new Date(scanResult.completedAt),
        totalBytes: scanResult.diskMetrics?.totalBytes.toString() ?? null,
        freeBytes: scanResult.diskMetrics?.freeBytes.toString() ?? null,
        scannedDirectoryCount: scanResult.scannedDirectoryCount,
        inaccessibleDirectoryCount: scanResult.inaccessibleDirectoryCount,
        errorMessage: scanResult.errorMessage,
      },
    });

    // Persist directory snapshots.
    if (scanResult.directories.length > 0) {
      await tx.directorySnapshot.createMany({
        data: scanResult.directories.map((d: DirectoryMeasurement) => ({
          scanId,
          normalizedPath: d.normalizedPath,
          displayName: d.displayName,
          sizeBytes: d.sizeBytes.toString(),
          filesCount: d.filesCount !== null ? d.filesCount.toString() : null,
          directoriesCount:
            d.directoriesCount !== null ? d.directoriesCount.toString() : null,
          measurementComplete: d.measurementComplete,
        })),
        skipDuplicates: true,
      });
    }
  });

  // Run comparison and findings generation (outside the main transaction).
  if (scanResult.status === "completed" || scanResult.status === "partial") {
    try {
      await generateFindings({
        scanId,
        deviceId,
        rootPath,
        scanResult,
        lowSpaceThresholdPercent: parseFloat(lowSpaceThresholdPercent),
      });
    } catch (err) {
      // Findings errors are non-fatal — the scan result is already persisted.
      console.error(`[findings] Error generating findings for scan ${scanId}:`, err);
    }
  }

  runningScanRoots.delete(rootPath);
}

// Active AbortControllers, keyed by scan ID.
const activeScanControllers = new Map<string, AbortController>();

/**
 * On application startup: detect any scans left in "running" or "queued" state
 * from a previous crash/restart and mark them interrupted.
 */
export async function recoverStaleScan(): Promise<void> {
  const deviceId = await getOrCreateDeviceId();
  const stale = await prisma.scan.findMany({
    where: {
      deviceId,
      status: { in: ["running", "queued"] },
    },
  });

  if (stale.length === 0) return;

  await prisma.scan.updateMany({
    where: { id: { in: stale.map((s) => s.id) } },
    data: {
      status: "failed",
      completedAt: new Date(),
      errorMessage:
        "Scan was interrupted by an application restart and did not complete.",
    },
  });

  console.warn(
    `[startup] Marked ${stale.length} stale scan(s) as failed (interrupted by restart).`
  );
}

/**
 * Get the current status of a scan by ID.
 */
export async function getScanById(scanId: string) {
  return prisma.scan.findUnique({
    where: { id: scanId },
    include: {
      _count: { select: { directories: true } },
    },
  });
}

/**
 * List recent scans for the local device.
 */
export async function listScans(limit = 50, offset = 0) {
  const deviceId = await getOrCreateDeviceId();
  return prisma.scan.findMany({
    where: { deviceId },
    orderBy: { startedAt: "desc" },
    take: limit,
    skip: offset,
    include: {
      _count: { select: { directories: true } },
    },
  });
}

/**
 * Get directory snapshots for a specific scan.
 */
export async function getScanDirectories(scanId: string) {
  return prisma.directorySnapshot.findMany({
    where: { scanId },
    orderBy: { sizeBytes: "desc" },
  });
}

/**
 * Get the directory-level delta between a scan and the previous comparable scan.
 * Returns null if no previous comparable scan exists.
 */
export class InvalidScanComparisonError extends Error {}

export async function getScanChanges(scanId: string, previousScanId?: string) {
  const currentScan = await prisma.scan.findUnique({
    where: { id: scanId },
    include: { directories: true },
  });
  if (!currentScan) return null;

  let previousScan;
  if (previousScanId) {
    previousScan = await prisma.scan.findUnique({
      where: { id: previousScanId },
      include: { directories: true },
    });
    if (!previousScan) {
      throw new InvalidScanComparisonError("The selected baseline scan was not found.");
    }

    const currentIsComparable = currentScan.status === "completed" || currentScan.status === "partial";
    const previousIsComparable = previousScan.status === "completed" || previousScan.status === "partial";
    if (!currentIsComparable || !previousIsComparable) {
      throw new InvalidScanComparisonError("Only completed or incomplete scans can be compared.");
    }
    if (previousScan.id === currentScan.id || previousScan.startedAt >= currentScan.startedAt) {
      throw new InvalidScanComparisonError("The baseline must be an earlier scan than the current scan.");
    }
    if (previousScan.deviceId !== currentScan.deviceId || previousScan.rootPath !== currentScan.rootPath) {
      throw new InvalidScanComparisonError("Scans can only be compared for the same device and monitored root.");
    }
  } else {
    // Find the previous comparable scan: same device, same root, completed/partial,
    // started before this scan.
    previousScan = await prisma.scan.findFirst({
      where: {
        deviceId: currentScan.deviceId,
        rootPath: currentScan.rootPath,
        status: { in: ["completed", "partial"] },
        startedAt: { lt: currentScan.startedAt },
        id: { not: scanId },
      },
      orderBy: { startedAt: "desc" },
      include: { directories: true },
    });
  }

  if (!previousScan) {
    return { currentScan, previousScan: null, changes: [], isBaseline: true };
  }

  // Compute deltas.
  const changes = computeDeltas(currentScan.directories, previousScan.directories);
  return { currentScan, previousScan, changes, isBaseline: false };
}

// ---------------------------------------------------------------------------
// Delta computation (comparison service logic)
// ---------------------------------------------------------------------------

export interface DirectoryChange {
  normalizedPath: string;
  displayName: string;
  currentSizeBytes: string;
  previousSizeBytes: string | null;
  deltaBytes: string;
  percentChange: number | null;
  changeLabel: "increased" | "decreased" | "unchanged" | "new" | "removed";
  currentComplete: boolean;
  previousComplete: boolean | null;
  comparisonReliable: boolean;
}

function computeDeltas(
  current: Array<{ normalizedPath: string; displayName: string; sizeBytes: string; measurementComplete: boolean }>,
  previous: Array<{ normalizedPath: string; displayName: string; sizeBytes: string; measurementComplete: boolean }>
): DirectoryChange[] {
  const previousMap = new Map(previous.map((d) => [d.normalizedPath, d]));
  const currentMap = new Map(current.map((d) => [d.normalizedPath, d]));

  const changes: DirectoryChange[] = [];

  // Process current directories.
  for (const curr of current) {
    const prev = previousMap.get(curr.normalizedPath);
    const currentBytes = BigInt(curr.sizeBytes);
    const comparisonReliable = curr.measurementComplete && (prev?.measurementComplete ?? true);

    if (!prev) {
      // New directory (not in previous scan).
      changes.push({
        normalizedPath: curr.normalizedPath,
        displayName: curr.displayName,
        currentSizeBytes: curr.sizeBytes,
        previousSizeBytes: null,
        deltaBytes: curr.sizeBytes,
        percentChange: null,
        changeLabel: "new",
        currentComplete: curr.measurementComplete,
        previousComplete: null,
        comparisonReliable,
      });
      continue;
    }

    const prevBytes = BigInt(prev.sizeBytes);
    const delta = currentBytes - prevBytes;
    let percentChange: number | null = null;

    if (prevBytes > 0n) {
      // Safe division — previous is non-zero.
      percentChange = Number((delta * 10000n) / prevBytes) / 100;
    }
    // If prevBytes === 0 and currentBytes > 0 → newly observed; percentChange stays null.

    let changeLabel: DirectoryChange["changeLabel"];
    if (delta > 0n) changeLabel = "increased";
    else if (delta < 0n) changeLabel = "decreased";
    else changeLabel = "unchanged";

    changes.push({
      normalizedPath: curr.normalizedPath,
      displayName: curr.displayName,
      currentSizeBytes: curr.sizeBytes,
      previousSizeBytes: prev.sizeBytes,
      deltaBytes: delta.toString(),
      percentChange,
      changeLabel,
      currentComplete: curr.measurementComplete,
      previousComplete: prev.measurementComplete,
      comparisonReliable: curr.measurementComplete && prev.measurementComplete,
    });
  }

  // Directories present in previous but missing from current.
  for (const prev of previous) {
    if (!currentMap.has(prev.normalizedPath)) {
      changes.push({
        normalizedPath: prev.normalizedPath,
        displayName: prev.displayName,
        currentSizeBytes: "0",
        previousSizeBytes: prev.sizeBytes,
        deltaBytes: (-BigInt(prev.sizeBytes)).toString(),
        percentChange: -100,
        changeLabel: "removed",
        currentComplete: false,
        previousComplete: prev.measurementComplete,
        // Can't be certain — missing from current scan may mean scan coverage issue.
        comparisonReliable: false,
      });
    }
  }

  // Sort by absolute delta descending (largest changes first).
  return changes.sort((a, b) => {
    const absDeltaA = BigInt(a.deltaBytes) < 0n ? -BigInt(a.deltaBytes) : BigInt(a.deltaBytes);
    const absDeltaB = BigInt(b.deltaBytes) < 0n ? -BigInt(b.deltaBytes) : BigInt(b.deltaBytes);
    if (absDeltaB > absDeltaA) return 1;
    if (absDeltaB < absDeltaA) return -1;
    return 0;
  });
}
