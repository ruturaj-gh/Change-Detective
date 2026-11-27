import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pairingDeleteMany: vi.fn(),
  pairingCreate: vi.fn(),
  pairingFindFirst: vi.fn(),
  pairingFindUnique: vi.fn(),
  pairingUpdateMany: vi.fn(),
  pairingUpdate: vi.fn(),
  deviceCreate: vi.fn(),
}));

vi.mock("../src/db/client.js", () => ({
  prisma: {
    agentPairing: {
      deleteMany: mocks.pairingDeleteMany,
      create: mocks.pairingCreate,
      findFirst: mocks.pairingFindFirst,
      findUnique: mocks.pairingFindUnique,
      updateMany: mocks.pairingUpdateMany,
    },
    $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        agentPairing: {
          findFirst: mocks.pairingFindFirst,
          updateMany: mocks.pairingUpdateMany,
          update: mocks.pairingUpdate,
        },
        device: { create: mocks.deviceCreate },
      }),
  },
}));

vi.mock("../src/services/findings.service.js", () => ({
  generateFindings: vi.fn(),
}));

import {
  approveAgentPairing,
  createAgentPairing,
  getAgentPairingStatus,
  InvalidAgentPairingError,
} from "../src/services/agent.service.js";

const pairingId = "00000000-0000-4000-8000-000000000001";
const deviceId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";
const pairingSecret = "a".repeat(43);
const pairingSecretHash = createHash("sha256").update(pairingSecret).digest("hex");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pairingDeleteMany.mockResolvedValue({ count: 0 });
  mocks.pairingCreate.mockResolvedValue({ id: pairingId });
  mocks.pairingFindFirst.mockResolvedValue({
    id: pairingId,
    name: "workstation",
    osName: "Linux",
    monitoredRoot: "/home/user/Documents",
    pairingSecretHash,
    status: "pending",
    deviceId: null,
    expiresAt: new Date(Date.now() + 60_000),
  });
  mocks.pairingUpdateMany.mockResolvedValue({ count: 1 });
  mocks.pairingUpdate.mockResolvedValue({});
  mocks.deviceCreate.mockResolvedValue({});
});

describe("browser-approved agent pairing", () => {
  it("creates a short-lived request with only a hashed agent credential", async () => {
    await expect(
      createAgentPairing({
        pairingSecret,
        name: "workstation",
        osName: "Linux",
        monitoredRoot: "/home/user/Documents",
      })
    ).resolves.toMatchObject({ pairingId });

    expect(mocks.pairingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pairingSecretHash,
          monitoredRoot: "/home/user/Documents",
        }),
        select: { id: true },
      })
    );
    expect(mocks.pairingCreate.mock.calls[0]?.[0].data).not.toHaveProperty(
      "pairingSecret"
    );
  });

  it("rejects a root that does not match the device operating system", async () => {
    await expect(
      createAgentPairing({
        pairingSecret,
        name: "workstation",
        osName: "Linux",
        monitoredRoot: "C:\\Users\\user",
      })
    ).rejects.toBeInstanceOf(InvalidAgentPairingError);
    expect(mocks.pairingCreate).not.toHaveBeenCalled();
  });

  it("binds approval to the signed-in user and installs the same hashed credential", async () => {
    await expect(approveAgentPairing(userId, pairingId)).resolves.toBe(true);

    expect(mocks.pairingUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: pairingId, status: "pending" }),
        data: expect.objectContaining({ status: "approved", userId }),
      })
    );
    expect(mocks.deviceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        userId,
        name: "workstation",
        osName: "Linux",
        monitoredRoot: "/home/user/Documents",
        agentTokenHash: pairingSecretHash,
      }),
    });
    expect(mocks.pairingUpdate).toHaveBeenCalledWith({
      where: { id: pairingId },
      data: { deviceId: expect.any(String) },
    });
  });

  it("continues reporting approval after the pairing request expires", async () => {
    mocks.pairingFindFirst.mockResolvedValue({
      status: "approved",
      deviceId,
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(getAgentPairingStatus(pairingId, pairingSecret)).resolves.toEqual({
      status: "approved",
      deviceId,
    });
  });

  it("does not create a device when another approval already claimed the request", async () => {
    mocks.pairingUpdateMany.mockResolvedValue({ count: 0 });

    await expect(approveAgentPairing(userId, pairingId)).resolves.toBe(false);
    expect(mocks.deviceCreate).not.toHaveBeenCalled();
  });
});
