import { describe, expect, it } from "vitest";
import { AgentScanResultSchema } from "../src/schemas/agent.js";

const validResult = {
  rootPath: "/home/test",
  startedAt: "2026-11-16T10:00:00.000Z",
  completedAt: "2026-11-16T10:00:01.000Z",
  durationMs: 1000,
  status: "completed",
  diskMetrics: { totalBytes: "1000", freeBytes: "500" },
  directories: [
    {
      normalizedPath: "/home/test/Documents",
      displayName: "Documents",
      sizeBytes: "120",
      filesCount: "2",
      directoriesCount: "1",
      measurementComplete: true,
    },
  ],
  scannedDirectoryCount: 1,
  inaccessibleDirectoryCount: 0,
  totalErrorCount: 0,
  errorMessage: null,
};

describe("agent scan result validation", () => {
  it("accepts a complete JSON-safe scan result", () => {
    expect(AgentScanResultSchema.safeParse(validResult).success).toBe(true);
  });

  it("rejects inconsistent directory counts and non-decimal byte counts", () => {
    expect(
      AgentScanResultSchema.safeParse({
        ...validResult,
        scannedDirectoryCount: 2,
      }).success
    ).toBe(false);
    expect(
      AgentScanResultSchema.safeParse({
        ...validResult,
        diskMetrics: { totalBytes: "-1", freeBytes: "0" },
      }).success
    ).toBe(false);
  });

  it("rejects results with invalid timestamps", () => {
    expect(
      AgentScanResultSchema.safeParse({
        ...validResult,
        completedAt: "2026-11-16T09:59:59.000Z",
      }).success
    ).toBe(false);
  });
});
