/**
 * Core types for the Change Detective scanner package.
 *
 * All byte values are represented as `bigint` internally.
 * At JSON/API boundaries they are serialized as decimal strings (e.g. "123456789")
 * to avoid silent precision loss in JavaScript's IEEE-754 number type.
 *
 * Do NOT use `number` for byte counts anywhere in this package.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Options passed to the top-level scan function. */
export interface ScanOptions {
  /** Absolute Windows path of the drive or directory to scan (e.g. "C:\\"). */
  rootPath: string;

  /**
   * AbortSignal for cooperative cancellation.
   * The scanner checks this between directory traversals.
   */
  signal?: AbortSignal;

  /**
   * Optional progress callback fired after each top-level directory is measured.
   * Must not throw; errors are silently ignored to avoid breaking the scan.
   */
  onProgress?: (progress: ScanProgress) => void;

  /**
   * Scan metadata injected from the caller (e.g. the API layer).
   * The scanner does not generate IDs or interact with the database.
   */
  meta?: ScanMeta;
}

export interface ScanMeta {
  /** Caller-generated scan ID (UUID). */
  scanId?: string;
  /** Whether this was triggered manually or by the scheduler. */
  triggerType?: "manual" | "scheduled";
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface ScanProgress {
  /** How many top-level directories have been fully processed so far. */
  completedDirectories: number;
  /** Total top-level directories found (known after enumeration). */
  totalDirectories: number;
  /** Display name of the directory most recently finished. */
  lastDirectory: string;
}

// ---------------------------------------------------------------------------
// Per-directory measurement
// ---------------------------------------------------------------------------

/** Measurement result for a single top-level child directory. */
export interface DirectoryMeasurement {
  /**
   * Normalised path for comparison across scans.
   * Lower-cased, forward-slash separators removed.
   * Example: "c:\\users\\alice\\documents" normalises to "c:/users/alice/documents".
   */
  normalizedPath: string;

  /** Original display path as returned by the filesystem. */
  displayName: string;

  /**
   * Recursive logical file-size sum in bytes.
   * Use bigint; serialize as a decimal string at JSON boundaries.
   */
  sizeBytes: bigint;

  /**
   * Number of regular files observed.
   * null if the count could not be determined (e.g. due to errors).
   */
  filesCount: bigint | null;

  /**
   * Number of subdirectories observed.
   * null if the count could not be determined.
   */
  directoriesCount: bigint | null;

  /**
   * false when one or more subdirectories could not be fully measured
   * (permission error, file disappeared during scan, etc.).
   * An incomplete measurement must NEVER be treated as a definitive size.
   */
  measurementComplete: boolean;

  /** Errors encountered within this directory (safe, path-only details). */
  errors: MeasurementError[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface MeasurementError {
  /** Filesystem path where the error occurred. */
  path: string;
  /** Node.js error code (e.g. "EACCES", "ENOENT"). */
  code: string;
  /** Human-readable message (no stack trace). */
  message: string;
}

// ---------------------------------------------------------------------------
// Disk-level metrics
// ---------------------------------------------------------------------------

/** Drive-level capacity and free space. */
export interface DiskMetrics {
  /** Total bytes on the drive. */
  totalBytes: bigint;
  /** Free bytes on the drive. */
  freeBytes: bigint;
}

// ---------------------------------------------------------------------------
// Scan result
// ---------------------------------------------------------------------------

/** Final output of a completed (or cancelled/failed) scan. */
export interface ScanResult {
  /** The normalised root path that was scanned. */
  rootPath: string;

  /** Scan start time (ISO 8601). */
  startedAt: string;

  /** Scan end time (ISO 8601). May equal startedAt for very fast scans. */
  completedAt: string;

  /** Duration in milliseconds. */
  durationMs: number;

  /**
   * Overall scan status:
   * - completed  — all directories measured without coverage gaps.
   * - partial    — some directories could not be fully measured.
   * - failed     — the root could not be accessed at all.
   * - cancelled  — the caller cancelled via AbortSignal.
   */
  status: "completed" | "partial" | "failed" | "cancelled";

  /** Drive-level metrics, if available. null when unavailable. */
  diskMetrics: DiskMetrics | null;

  /** Per-directory measurements. Empty when status is "failed". */
  directories: DirectoryMeasurement[];

  /** Count of top-level directories successfully enumerated. */
  scannedDirectoryCount: number;

  /** Count of directories with at least one measurement error. */
  inaccessibleDirectoryCount: number;

  /** Total error count across all directories. */
  totalErrorCount: number;

  /**
   * Top-level error message when status is "failed".
   * Safe to display to the user (no stack traces or internal paths beyond root).
   */
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// JSON-serializable form (for API boundaries)
// ---------------------------------------------------------------------------

/**
 * Version of DirectoryMeasurement safe for JSON serialization.
 * bigint values are replaced with their decimal string representations.
 */
export interface DirectoryMeasurementJSON {
  normalizedPath: string;
  displayName: string;
  /** Decimal string representation of sizeBytes. */
  sizeBytes: string;
  filesCount: string | null;
  directoriesCount: string | null;
  measurementComplete: boolean;
  errors: MeasurementError[];
}

export interface DiskMetricsJSON {
  totalBytes: string;
  freeBytes: string;
}

export interface ScanResultJSON
  extends Omit<ScanResult, "diskMetrics" | "directories"> {
  diskMetrics: DiskMetricsJSON | null;
  directories: DirectoryMeasurementJSON[];
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

/** Serialize a ScanResult to a JSON-safe form. */
export function serializeScanResult(result: ScanResult): ScanResultJSON {
  return {
    ...result,
    diskMetrics: result.diskMetrics
      ? {
          totalBytes: result.diskMetrics.totalBytes.toString(),
          freeBytes: result.diskMetrics.freeBytes.toString(),
        }
      : null,
    directories: result.directories.map(serializeDirectoryMeasurement),
  };
}

export function serializeDirectoryMeasurement(
  d: DirectoryMeasurement
): DirectoryMeasurementJSON {
  return {
    normalizedPath: d.normalizedPath,
    displayName: d.displayName,
    sizeBytes: d.sizeBytes.toString(),
    filesCount: d.filesCount !== null ? d.filesCount.toString() : null,
    directoriesCount:
      d.directoriesCount !== null ? d.directoriesCount.toString() : null,
    measurementComplete: d.measurementComplete,
    errors: d.errors,
  };
}

