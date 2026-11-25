import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deviceFindUnique: vi.fn(),
  deviceFindUniqueOrThrow: vi.fn(),
  scanCreateMany: vi.fn(),
  scanFindUnique: vi.fn(),
  scanFindFirst: vi.fn(),
  scanUpdateMany: vi.fn(),
  directoryCreateMany: vi.fn(),
  settingsFindUniqueOrThrow: vi.fn(),
  generateFindings: vi.fn(),
}));

vi.mock("../src/db/client.js", () => ({
  prisma: {
    device: {
      findUnique: mocks.deviceFindUnique,
      findUniqueOrThrow: mocks.deviceFindUniqueOrThrow,
    },
    scan: {
      createMany: mocks.scanCreateMany,
      findUnique: mocks.scanFindUnique,
      findFirst: mocks.scanFindFirst,
    },
    $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        scan: { updateMany: mocks.scanUpdateMany },
        directorySnapshot: { createMany: mocks.directoryCreateMany },
      }),
    settings: { findUniqueOrThrow: mocks.settingsFindUniqueOrThrow },
  },
}));

vi.mock("../src/services/findings.service.js", () => ({
  generateFindings: mocks.generateFindings,
}));

import {
  getAgentScanIntervalMinutes,
  InvalidAgentScanResultError,
  saveAgentLocalScanResult,
  saveAgentScanResult,
} from "../src/services/agent.service.js";

const deviceId = "00000000-0000-4000-8000-000000000001";
const scanId = "00000000-0000-4000-8000-000000000002";
const result = {
  rootPath: "/home/test",
  startedAt: "2026-11-24T05:00:00.000Z",
  completedAt: "2026-11-24T05:00:01.000Z",
  durationMs: 1000,
  status: "completed" as const,
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
const device = {
  id: deviceId,
  userId: "00000000-0000-4000-8000-000000000003",
  monitoredRoot: "/home/test",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.deviceFindUnique.mockResolvedValue(device);
  mocks.deviceFindUniqueOrThrow.mockResolvedValue({
    user: { settings: { scanIntervalMinutes: 45 } },
  });
  mocks.scanCreateMany.mockResolvedValue({ count: 1 });
  mocks.scanFindUnique.mockResolvedValue({
    id: scanId,
    deviceId,
    rootPath: "/home/test",
    triggerType: "event",
    status: "running",
  });
  mocks.scanFindFirst.mockResolvedValue({
    id: scanId,
    deviceId,
    rootPath: "/home/test",
    status: "running",
  });
  mocks.scanUpdateMany.mockResolvedValue({ count: 1 });
  mocks.directoryCreateMany.mockResolvedValue({ count: 1 });
  mocks.settingsFindUniqueOrThrow.mockResolvedValue({
    lowSpaceThresholdPercent: 10,
  });
  mocks.generateFindings.mockResolvedValue(undefined);
});

describe("agent-collected local scans", () => {
  it("uses the account-configured local scan interval", async () => {
    await expect(getAgentScanIntervalMinutes(deviceId)).resolves.toBe(45);
  });

  it("creates and persists an event-triggered scan for the approved root", async () => {
    await saveAgentLocalScanResult(deviceId, scanId, "event", result);

    expect(mocks.scanCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            id: scanId,
            deviceId,
            rootPath: "/home/test",
            triggerType: "event",
          }),
        ],
        skipDuplicates: true,
      })
    );
    expect(mocks.scanUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: scanId, deviceId, status: "running" },
        data: expect.objectContaining({ status: "completed" }),
      })
    );
    expect(mocks.directoryCreateMany).toHaveBeenCalled();
  });

  it("rejects a local result outside the approved root", async () => {
    await expect(
      saveAgentLocalScanResult(deviceId, scanId, "scheduled", {
        ...result,
        rootPath: "/home/other",
      })
    ).rejects.toBeInstanceOf(InvalidAgentScanResultError);

    expect(mocks.scanCreateMany).not.toHaveBeenCalled();
  });

  it("acknowledges a retried scan ID after the result was already persisted", async () => {
    mocks.scanCreateMany.mockResolvedValue({ count: 0 });
    mocks.scanFindUnique.mockResolvedValue({
      id: scanId,
      deviceId,
      rootPath: "/home/test",
      status: "completed",
    });

    await expect(
      saveAgentLocalScanResult(deviceId, scanId, "scheduled", result)
    ).resolves.toBeUndefined();
    expect(mocks.scanUpdateMany).not.toHaveBeenCalled();
  });

  it("acknowledges a task result retry after the first response was lost", async () => {
    mocks.scanFindFirst.mockResolvedValue({
      id: scanId,
      deviceId,
      rootPath: "/home/test",
      status: "completed",
    });

    await expect(
      saveAgentScanResult(deviceId, scanId, result)
    ).resolves.toBeUndefined();
    expect(mocks.scanUpdateMany).not.toHaveBeenCalled();
  });
});
