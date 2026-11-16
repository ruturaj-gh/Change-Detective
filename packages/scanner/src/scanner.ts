/**
 * Change Detective — cross-platform top-level directory scanner.
 *
 * Scans a configured root directory, recursively measuring the size of each
 * immediate child directory using incremental traversal (no full tree in memory).
 *
 * Design constraints (from the project brief §11):
 * - Never reads file contents or computes hashes.
 * - Does not follow symlinks or Windows reparse points.
 * - Handles permission errors and file disappearance without crashing.
 * - Marks measurements incomplete when full coverage is not possible.
 * - Uses bigint for all byte arithmetic; decimal strings at JSON boundaries.
 * - Supports cancellation via AbortSignal.
 * - Supports progress callbacks.
 * - Has no PostgreSQL, API, or dashboard dependencies.
 */

import { opendir, stat } from "node:fs/promises";
import { join, normalize, win32 } from "node:path";
import type {
  ScanOptions,
  ScanResult,
  DirectoryMeasurement,
  MeasurementError,
} from "./types.js";
import { getDiskMetrics } from "./windows/diskspace.js";
import { isReparsePoint } from "./windows/reparse.js";

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run a full directory scan rooted at `options.rootPath`.
 *
 * Returns a `ScanResult`. Never throws — all errors are captured in the
 * result's status and error fields.
 */
export async function scan(options: ScanOptions): Promise<ScanResult> {
  const startedAt = new Date();
  const { rootPath, signal, onProgress, meta: _meta } = options;

  // Normalise the root path (consistent separators, no trailing slash on dirs).
  const normRoot = normalizePath(rootPath);

  // --- 1. Validate root ---
  let rootStat;
  try {
    rootStat = await stat(normRoot);
  } catch (err) {
    return buildFailedResult(
      normRoot,
      startedAt,
      `Root path could not be accessed: ${safeMessage(err)}`
    );
  }

  if (!rootStat.isDirectory()) {
    return buildFailedResult(
      normRoot,
      startedAt,
      `Root path is not a directory: ${normRoot}`
    );
  }

  // --- 2. Check for cancellation after validation ---
  if (signal?.aborted) {
    return buildCancelledResult(normRoot, startedAt, []);
  }

  // --- 3. Get disk metrics (non-fatal) ---
  const diskMetrics = await getDiskMetrics(normRoot);

  // --- 4. Enumerate immediate child directories ---
  let childDirs: string[] = [];
  let enumerationError: string | null = null;

  try {
    childDirs = await enumerateChildDirectories(normRoot, signal);
  } catch (err) {
    // If we can't even enumerate children, the scan fails.
    return buildFailedResult(
      normRoot,
      startedAt,
      `Failed to enumerate root children: ${safeMessage(err)}`
    );
  }

  const measurements: DirectoryMeasurement[] = [];
  let inaccessibleCount = 0;
  let totalErrorCount = 0;

  for (let i = 0; i < childDirs.length; i++) {
    if (signal?.aborted) {
      return buildCancelledResult(normRoot, startedAt, measurements);
    }

    const childPath = childDirs[i];
    if (childPath === undefined) continue;

    const measurement = await measureDirectory(childPath, signal);
    measurements.push(measurement);

    if (!measurement.measurementComplete) {
      inaccessibleCount++;
    }
    totalErrorCount += measurement.errors.length;

    // Fire progress callback (errors in callback are swallowed).
    if (onProgress) {
      try {
        onProgress({
          completedDirectories: i + 1,
          totalDirectories: childDirs.length,
          lastDirectory: measurement.displayName,
        });
      } catch {
        // Intentionally ignored.
      }
    }
  }

  // --- 6. Determine overall status ---
  const completedAt = new Date();
  const hasPartial = measurements.some((m) => !m.measurementComplete);
  const overallStatus = hasPartial ? "partial" : "completed";

  return {
    rootPath: normRoot,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    status: overallStatus,
    diskMetrics,
    directories: measurements,
    scannedDirectoryCount: measurements.length,
    inaccessibleDirectoryCount: inaccessibleCount,
    totalErrorCount,
    errorMessage: enumerationError,
  };
}

// ---------------------------------------------------------------------------
// Child directory enumeration
// ---------------------------------------------------------------------------

/**
 * Returns the full paths of all immediate child directories under `rootPath`.
 * Skips reparse points (symlinks, junctions) and non-directory entries.
 * Throws if the root itself cannot be opened.
 */
async function enumerateChildDirectories(
  rootPath: string,
  signal?: AbortSignal
): Promise<string[]> {
  const results: string[] = [];
  const dir = await opendir(rootPath);

  try {
    for await (const dirent of dir) {
      if (signal?.aborted) break;

      // Skip non-directories (files, devices, etc.).
      if (!dirent.isDirectory() && !dirent.isSymbolicLink()) {
        continue;
      }

      const fullPath = join(rootPath, dirent.name);

      // Skip reparse points (symlinks/junctions) — do not follow them.
      const reparse = await isReparsePoint(dirent, fullPath);
      if (reparse) {
        continue;
      }

      // After reparse check, confirm it's a directory.
      if (dirent.isDirectory()) {
        results.push(fullPath);
      }
    }
  } finally {
    // Ensure the directory handle is closed even if we break out early.
    try {
      await dir.close();
    } catch {
      // Best-effort close.
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Recursive directory measurement
// ---------------------------------------------------------------------------

interface MeasureState {
  sizeBytes: bigint;
  filesCount: bigint;
  directoriesCount: bigint;
  complete: boolean;
  errors: MeasurementError[];
}

/**
 * Recursively measures a single top-level child directory.
 * Uses an iterative stack to avoid deep call stacks on large trees.
 * Never keeps the entire directory tree in memory.
 */
async function measureDirectory(
  dirPath: string,
  signal?: AbortSignal
): Promise<DirectoryMeasurement> {
  const displayName = extractDisplayName(dirPath);
  const normalizedPath = normalizePath(dirPath);

  const state: MeasureState = {
    sizeBytes: 0n,
    filesCount: 0n,
    directoriesCount: 0n,
    complete: true,
    errors: [],
  };

  // Iterative traversal using an explicit stack (avoids deep recursion).
  const stack: string[] = [dirPath];

  while (stack.length > 0) {
    if (signal?.aborted) {
      // Mark incomplete — we stopped early.
      state.complete = false;
      break;
    }

    const currentPath = stack.pop();
    if (currentPath === undefined) break;

    await traverseDirectory(currentPath, state, stack, signal);
  }

  return {
    normalizedPath,
    displayName,
    sizeBytes: state.sizeBytes,
    filesCount: state.filesCount,
    directoriesCount: state.directoriesCount,
    measurementComplete: state.complete,
    errors: state.errors,
  };
}

/**
 * Processes one directory level: enumerates entries, sums file sizes,
 * and pushes subdirectories onto the stack for later processing.
 */
async function traverseDirectory(
  dirPath: string,
  state: MeasureState,
  stack: string[],
  signal?: AbortSignal
): Promise<void> {
  let dir;

  try {
    dir = await opendir(dirPath);
  } catch (err) {
    recordError(state, dirPath, err);
    return;
  }

  try {
    for await (const dirent of dir) {
      if (signal?.aborted) {
        state.complete = false;
        break;
      }

      const fullPath = join(dirPath, dirent.name);

      if (dirent.isSymbolicLink()) {
        // Skip all symlinks/reparse points — do not follow.
        continue;
      }

      if (dirent.isDirectory()) {
        // Check if it's a reparse point before descending.
        const reparse = await isReparsePoint(dirent, fullPath).catch(
          () => false
        );
        if (reparse) continue;

        state.directoriesCount++;
        stack.push(fullPath);
        continue;
      }

      if (dirent.isFile()) {
        // Measure the file size.
        try {
          const fileStat = await stat(fullPath);
          state.sizeBytes += BigInt(fileStat.size);
          state.filesCount++;
        } catch (err) {
          // File may have disappeared between enumeration and stat.
          recordError(state, fullPath, err);
        }
      }
      // Other entry types (devices, sockets, etc.) are ignored.
    }
  } catch (err) {
    // Error during iteration (e.g. directory became inaccessible mid-scan).
    recordError(state, dirPath, err);
  } finally {
    try {
      await dir.close();
    } catch {
      // Best-effort close.
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recordError(
  state: MeasureState,
  path: string,
  err: unknown
): void {
  state.complete = false;
  state.errors.push({
    path,
    code: errorCode(err),
    message: safeMessage(err),
  });
}

function errorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    return String((err as NodeJS.ErrnoException).code ?? "UNKNOWN");
  }
  return "UNKNOWN";
}

function safeMessage(err: unknown): string {
  if (err instanceof Error) {
    // Exclude stack traces; include only the message.
    return err.message;
  }
  return String(err);
}

/**
 * Normalises paths for stable cross-scan comparison. Windows paths are
 * case-insensitive; POSIX paths preserve case because their filesystems may
 * distinguish names that differ only by letter case.
 */
export function normalizePath(p: string): string {
  const isWindowsPath =
    process.platform === "win32" || /^[A-Za-z]:/.test(p) || p.startsWith("\\\\");

  if (isWindowsPath) {
    return win32.normalize(p).replace(/\\/g, "/").toLowerCase();
  }

  return normalize(p);
}

/**
 * Extracts the last path component as the display name.
 * For a drive root like "C:/", returns "C:".
 */
function extractDisplayName(p: string): string {
  const normalized = normalize(p);
  // On Windows, path.basename("C:\\") returns "" — handle drive roots.
  const parts = normalized.split(/[\\/]/);
  const last = parts[parts.length - 1];
  return last !== undefined && last !== "" ? last : normalized.replace(/\\/g, "");
}

// ---------------------------------------------------------------------------
// Result builders
// ---------------------------------------------------------------------------

function buildFailedResult(
  rootPath: string,
  startedAt: Date,
  message: string
): ScanResult {
  const completedAt = new Date();
  return {
    rootPath,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    status: "failed",
    diskMetrics: null,
    directories: [],
    scannedDirectoryCount: 0,
    inaccessibleDirectoryCount: 0,
    totalErrorCount: 0,
    errorMessage: message,
  };
}

function buildCancelledResult(
  rootPath: string,
  startedAt: Date,
  directories: DirectoryMeasurement[]
): ScanResult {
  const completedAt = new Date();
  const inaccessibleCount = directories.filter(
    (d) => !d.measurementComplete
  ).length;
  const totalErrorCount = directories.reduce(
    (sum, d) => sum + d.errors.length,
    0
  );
  return {
    rootPath,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    status: "cancelled",
    diskMetrics: null,
    directories,
    scannedDirectoryCount: directories.length,
    inaccessibleDirectoryCount: inaccessibleCount,
    totalErrorCount,
    errorMessage: "Scan was cancelled by the caller.",
  };
}

