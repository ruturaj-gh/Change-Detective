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
import { hostname } from "node:os";
import { LEGACY_USER_ID } from "../auth/accounts.js";

// ---------------------------------------------------------------------------
// In-process concurrency guard: one scan per normalized root path.
// ---------------------------------------------------------------------------
const runningScanRoots = new Set<string>();

export interface StartScanResult {
  scanId: string;
  status: "queued" | "already_running";
  existingScanId?: string | undefined;
}

export class NoEnrolledAgentError extends Error {}

/**
 * Starts a manual scan asynchronously.
 * Returns the scan ID immediately (202-style) and runs the scan in the background.
 */
export async function startScan(
  userId: string,
  triggerType: "manual" | "scheduled",
  requestedDeviceId?: string
): Promise<StartScanResult> {
  const agentMode = process.env["SCAN_MODE"] === "agent";
  const settings = await prisma.settings.findUniqueOrThrow({ where: { userId } });
  const device = agentMode
    ? await prisma.device.findFirst({
        where: {
          userId,
          agentTokenHash: { not: null },
          ...(requestedDeviceId ? { id: requestedDeviceId } : {}),
        },
        orderBy: { lastSeenAt: "desc" },
        select: { id: true, monitoredRoot: true },
      })
    : await prisma.device.findFirst({
        where: {
          userId,
          agentTokenHash: null,
          ...(requestedDeviceId ? { id: requestedDeviceId } : {}),
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, monitoredRoot: true },
      });
  if (!device && (agentMode || requestedDeviceId)) {
    throw new NoEnrolledAgentError(
      agentMode
        ? "Select an enrolled scanning device before starting a scan."
        : "The selected device is not available."
    );
  }
  const localDeviceId =
    device?.id ??
    (userId === LEGACY_USER_ID ? await getOrCreateDeviceId() : randomUUID());
  const rootPath = device?.monitoredRoot ?? settings.monitoredRoot;
  if (agentMode && (!device?.monitoredRoot || !rootPath)) {
    throw new NoEnrolledAgentError(
      "The monitored root does not match the enrolled agent's approved root."
    );
  }
  const deviceId = localDeviceId;
  if (!device) {
    const osName =
      process.platform === "win32"
        ? "Windows"
        : process.platform === "darwin"
          ? "macOS"
          : process.platform === "linux"
            ? "Linux"
            : process.platform;
    await prisma.device.create({
      data: {
        id: deviceId,
        userId,
        name: hostname(),
        osName,
        monitoredRoot: settings.monitoredRoot,
      },
    });
  }
  const normalizedRoot = normalizePath(rootPath);
  const scanKey = `${deviceId}:${normalizedRoot}`;

  // Concurrency check — prevent overlapping scans for the same root.
  const existingScan = await prisma.scan.findFirst({
    where: {
      deviceId,
      rootPath: normalizedRoot,
      status: { in: ["queued", "running"] },
    },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  if (existingScan && (agentMode || runningScanRoots.has(scanKey))) {
    return {
      scanId: existingScan.id,
      status: "already_running" as const,
      existingScanId: existingScan.id,
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

  if (!agentMode) {
    // Fire and forget — do NOT await this.
    void executeScan(
      scanId,
      userId,
      deviceId,
      scanKey,
      normalizedRoot,
      settings.lowSpaceThresholdPercent.toString()
    );
  }

  return { scanId, status: "queued" };
}

/**
 * Executes the scan, persists results, runs comparison, and generates findings.
 * Called asynchronously from startScan — errors are captured in the scan record.
 */
async function executeScan(
  scanId: string,
  userId: string,
  deviceId: string,
  scanKey: string,
  rootPath: string,
  lowSpaceThresholdPercent: string
): Promise<void> {
  runningScanRoots.add(scanKey);

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
    runningScanRoots.delete(scanKey);
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
        userId,
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

  runningScanRoots.delete(scanKey);
}

// Active AbortControllers, keyed by scan ID.
const activeScanControllers = new Map<string, AbortController>();

/**
 * On application startup: detect any scans left in "running" or "queued" state
 * from a previous crash/restart and mark them interrupted.
 */
export async function recoverStaleScan(): Promise<void> {
  if (process.env["SCAN_MODE"] === "agent") return;

  const stale = await prisma.scan.findMany({
    where: {
      device: { is: { agentTokenHash: null } },
      status: { in: ["running", "queued"] },
    },
    select: { id: true },
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
export async function getScanById(scanId: string, userId: string) {
  return prisma.scan.findFirst({
    where: { id: scanId, device: { is: { userId } } },
    include: {
      _count: { select: { directories: true } },
    },
  });
}

/**
 * List recent scans for the local device.
 */
export async function listScans(
  userId: string,
  limit = 50,
  offset = 0,
  deviceId?: string
) {
  return prisma.scan.findMany({
    where: {
      device: { is: { userId, ...(deviceId ? { id: deviceId } : {}) } },
    },
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
export async function getScanDirectories(scanId: string, userId: string) {
  return prisma.directorySnapshot.findMany({
    where: { scanId, scan: { device: { is: { userId } } } },
    orderBy: { sizeBytes: "desc" },
  });
}

/**
 * Get the directory-level delta between a scan and the previous comparable scan.
 * Returns null if no previous comparable scan exists.
 */
export class InvalidScanComparisonError extends Error {}

export async function getScanChanges(
  scanId: string,
  userId: string,
  previousScanId?: string
) {
  const currentScan = await prisma.scan.findFirst({
    where: { id: scanId, device: { is: { userId } } },
    include: { directories: true },
  });
  if (!currentScan) return null;

  let previousScan;
  if (previousScanId) {
    previousScan = await prisma.scan.findFirst({
      where: { id: previousScanId, device: { is: { userId } } },
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
