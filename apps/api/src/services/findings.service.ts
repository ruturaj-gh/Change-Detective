/**
 * Findings service — Phase 2.
 *
 * Deterministic findings rules. Every finding must:
 * - State the exact rule that triggered it.
 * - Include the measured values in `evidence`.
 * - Not claim to identify the cause (only observed facts).
 * - Never generate an AI health score.
 */
import { prisma } from "../db/client.js";
import type { Prisma } from "@prisma/client";
import type { ScanResult } from "@change-detective/scanner";
import { getScanChanges } from "./scan.service.js";

// Threshold for "significant growth" finding: 500 MB default.
// Documented here so it is easy to make configurable later.
const SIGNIFICANT_GROWTH_BYTES = 500n * 1024n * 1024n; // 500 MiB

export interface FindingsInput {
  scanId: string;
  deviceId: string;
  rootPath: string;
  scanResult: ScanResult;
  lowSpaceThresholdPercent: number;
}

/**
 * Generate and persist deterministic findings for a completed scan.
 */
export async function generateFindings(input: FindingsInput): Promise<void> {
  const { scanId, deviceId, scanResult, lowSpaceThresholdPercent } = input;
  const findings: FindingData[] = [];

  // --- Rule 1: Incomplete scan ---
  if (scanResult.status === "partial") {
    findings.push({
      deviceId,
      scanId,
      findingType: "incomplete_scan",
      severity: "warning",
      title: "Scan coverage incomplete",
      description: `The scan could not fully measure ${scanResult.inaccessibleDirectoryCount} director${scanResult.inaccessibleDirectoryCount === 1 ? "y" : "ies"}. Results for those paths are marked incomplete and excluded from change comparisons.`,
      evidence: toJson({
        rule: "incomplete_scan",
        inaccessibleDirectoryCount: scanResult.inaccessibleDirectoryCount,
        totalErrorCount: scanResult.totalErrorCount,
        scanId,
      }),
    });
  }

  // --- Rule 2: Scan failed/interrupted ---
  if (scanResult.status === "failed" || scanResult.status === "cancelled") {
    findings.push({
      deviceId,
      scanId,
      findingType: "scan_failed",
      severity: "warning",
      title: `Scan ${scanResult.status}`,
      description: scanResult.errorMessage ?? "The scan did not complete successfully.",
      evidence: toJson({
        rule: "scan_failed",
        status: scanResult.status,
        errorMessage: scanResult.errorMessage,
        scanId,
      }),
    });
  }

  // --- Rule 3: Low free space ---
  if (scanResult.diskMetrics) {
    const { totalBytes, freeBytes } = scanResult.diskMetrics;
    if (totalBytes > 0n) {
      const freePercent = Number((freeBytes * 100n) / totalBytes);
      if (freePercent < lowSpaceThresholdPercent) {
        const severity = freePercent < 5 ? "critical" : "warning";
        findings.push({
          deviceId,
          scanId,
          findingType: "low_free_space",
          severity,
          title: "Low disk space",
          description: `Free space on the monitored drive is ${freePercent.toFixed(1)}%, below the configured threshold of ${lowSpaceThresholdPercent}%.`,
          evidence: toJson({
            rule: "low_free_space",
            freeBytes: freeBytes.toString(),
            totalBytes: totalBytes.toString(),
            freePercent: parseFloat(freePercent.toFixed(2)),
            thresholdPercent: lowSpaceThresholdPercent,
            scanId,
          }),
        });
      }
    }
  }

  // --- Rule 4: Significant directory growth ---
  const changesResult = await getScanChanges(scanId);
  if (changesResult && !changesResult.isBaseline && changesResult.previousScan) {
    for (const change of changesResult.changes) {
      if (
        change.changeLabel === "increased" &&
        change.comparisonReliable &&
        BigInt(change.deltaBytes) >= SIGNIFICANT_GROWTH_BYTES
      ) {
        const deltaMiB = (Number(BigInt(change.deltaBytes)) / (1024 * 1024)).toFixed(1);
        findings.push({
          deviceId,
          scanId,
          findingType: "significant_growth",
          severity: "warning",
          title: `Significant growth: ${change.displayName}`,
          description: `Directory "${change.displayName}" grew by ${deltaMiB} MiB since the previous scan. This is an observed measurement change; the cause is not determined by this tool.`,
          evidence: toJson({
            rule: "significant_growth",
            normalizedPath: change.normalizedPath,
            displayName: change.displayName,
            previousSizeBytes: change.previousSizeBytes,
            currentSizeBytes: change.currentSizeBytes,
            deltaBytes: change.deltaBytes,
            percentChange: change.percentChange,
            thresholdBytes: SIGNIFICANT_GROWTH_BYTES.toString(),
            currentScanId: scanId,
            previousScanId: changesResult.previousScan.id,
          }),
        });
      }
    }
  }

  // Persist all findings.
  if (findings.length > 0) {
    await prisma.finding.createMany({ data: findings });
  }
}

interface FindingData {
  deviceId: string;
  scanId: string;
  findingType: string;
  severity: string;
  title: string;
  description: string;
  evidence: Prisma.InputJsonValue;
}

// Helper: cast a plain object to Prisma.InputJsonValue
function toJson(obj: Record<string, string | number | boolean | null | undefined>): Prisma.InputJsonValue {
  // JSON.parse/stringify strips undefined values which Prisma's JSON doesn't accept.
  return JSON.parse(JSON.stringify(obj)) as Prisma.InputJsonValue;
}

/**
 * List findings for the local device.
 */
export async function listFindings(limit = 100, offset = 0) {
  const { getOrCreateDeviceId } = await import("../config/device-id.js");
  const deviceId = await getOrCreateDeviceId();
  return prisma.finding.findMany({
    where: { deviceId },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
    include: {
      scan: { select: { rootPath: true, startedAt: true } },
    },
  });
}
