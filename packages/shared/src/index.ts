/**
 * @change-detective/shared
 *
 * Shared types and utilities used by both the API and the web dashboard.
 * Currently a placeholder — types will be added here when the dashboard
 * (Phase 4) is built so API response shapes can be shared without duplication.
 */

// Re-export scanner types that the dashboard will consume.
export type {
  DirectoryMeasurementJSON,
  ScanResultJSON,
  DiskMetricsJSON,
  MeasurementError,
} from "@change-detective/scanner";

