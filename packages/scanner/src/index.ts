// Public exports for the @change-detective/scanner package.
export { scan, normalizePath } from "./scanner.js";
export {
  serializeScanResult,
  serializeDirectoryMeasurement,
} from "./types.js";
export type {
  ScanOptions,
  ScanMeta,
  ScanProgress,
  ScanResult,
  ScanResultJSON,
  DirectoryMeasurement,
  DirectoryMeasurementJSON,
  DiskMetrics,
  DiskMetricsJSON,
  MeasurementError,
} from "./types.js";

