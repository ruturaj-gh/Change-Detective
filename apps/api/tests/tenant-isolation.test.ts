import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scanFindMany: vi.fn(),
  scanFindFirst: vi.fn(),
  directoryFindMany: vi.fn(),
  findingFindMany: vi.fn(),
  settingsFindUniqueOrThrow: vi.fn(),
}));

vi.mock("../src/db/client.js", () => ({
  prisma: {
    scan: { findMany: mocks.scanFindMany, findFirst: mocks.scanFindFirst },
    directorySnapshot: { findMany: mocks.directoryFindMany },
    finding: { findMany: mocks.findingFindMany },
    settings: { findUniqueOrThrow: mocks.settingsFindUniqueOrThrow },
  },
}));

import {
  getScanById,
  getScanChanges,
  getScanDirectories,
  listScans,
} from "../src/services/scan.service.js";
import { listFindings } from "../src/services/findings.service.js";
import { getSettings } from "../src/services/settings.service.js";

const userId = "00000000-0000-4000-8000-000000000002";
const otherUserId = "00000000-0000-4000-8000-000000000003";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("tenant-scoped data services", () => {
  it("scopes scan lists, lookups, and directory snapshots to the requesting user", async () => {
    mocks.scanFindMany.mockResolvedValue([]);
    mocks.scanFindFirst.mockResolvedValue(null);
    mocks.directoryFindMany.mockResolvedValue([]);

    await listScans(userId);
    expect(mocks.scanFindMany.mock.calls[0]![0]).toMatchObject({
      where: { device: { is: { userId } } },
    });

    await getScanById("scan-id", userId);
    expect(mocks.scanFindFirst.mock.calls[0]![0]).toMatchObject({
      where: { id: "scan-id", device: { is: { userId } } },
    });

    await getScanDirectories("scan-id", userId);
    expect(mocks.directoryFindMany.mock.calls[0]![0]).toMatchObject({
      where: { scanId: "scan-id", scan: { device: { is: { userId } } } },
    });
    expect(JSON.stringify(mocks.scanFindMany.mock.calls[0]![0])).not.toContain(
      otherUserId
    );
  });

  it("scopes both scans in a comparison and account-level findings", async () => {
    mocks.scanFindFirst
      .mockResolvedValueOnce({
        id: "current",
        deviceId: "device",
        rootPath: "/root",
        startedAt: new Date("2026-01-02T00:00:00Z"),
        status: "completed",
        directories: [],
      })
      .mockResolvedValueOnce({
        id: "baseline",
        deviceId: "device",
        rootPath: "/root",
        startedAt: new Date("2026-01-01T00:00:00Z"),
        status: "completed",
        directories: [],
      });
    mocks.findingFindMany.mockResolvedValue([]);

    await getScanChanges("current", userId, "baseline");
    expect(mocks.scanFindFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: "current", device: { is: { userId } } },
      })
    );
    expect(mocks.scanFindFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: "baseline", device: { is: { userId } } },
      })
    );

    await listFindings(userId);
    expect(mocks.findingFindMany.mock.calls[0]![0]).toMatchObject({
      where: { device: { is: { userId } } },
    });
  });

  it("loads settings by account identity", async () => {
    mocks.settingsFindUniqueOrThrow.mockResolvedValue({});
    await getSettings(userId);
    expect(mocks.settingsFindUniqueOrThrow).toHaveBeenCalledWith({
      where: { userId },
    });
  });
});
