import { createHash, randomBytes, randomUUID } from "node:crypto";
import { normalizePath } from "@change-detective/scanner";
import { prisma } from "../db/client.js";
import { generateFindings } from "./findings.service.js";
import type { ScanResult } from "@change-detective/scanner";
import type { AgentScanResult } from "../schemas/agent.js";
import { isAgentRootAbsolute } from "../schemas/agent-enrollment.js";

const ENROLLMENT_TTL_MS = 15 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createAgentEnrollment(userId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS);

  await prisma.agentEnrollment.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  await prisma.agentEnrollment.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  });

  return { token, expiresAt };
}

export class InvalidEnrollmentTokenError extends Error {}
export class InvalidAgentRootError extends Error {}

export async function updateAgentMonitoredRoot(
  userId: string,
  deviceId: string,
  monitoredRoot: string
): Promise<boolean> {
  const device = await prisma.device.findFirst({
    where: { id: deviceId, userId, agentTokenHash: { not: null } },
    select: { osName: true },
  });
  if (!device) return false;
  if (!isAgentRootAbsolute(device.osName, monitoredRoot) || monitoredRoot.includes("\0")) {
    throw new InvalidAgentRootError(
      "The monitored root must be an absolute path for this device's operating system."
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.device.updateMany({
      where: { id: deviceId, userId, agentTokenHash: { not: null } },
      data: { monitoredRoot: normalizePath(monitoredRoot.trim()) },
    });
    if (updated.count !== 1) return false;
    await tx.scan.updateMany({
      where: {
        deviceId,
        status: { in: ["queued", "running"] },
      },
      data: {
        status: "failed",
        completedAt: new Date(),
        agentLeaseUntil: null,
        errorMessage: "The monitored root changed before this scan completed.",
      },
    });
    return true;
  });
}

export async function enrollAgent(input: {
  token: string;
  name: string;
  osName: string;
  monitoredRoot: string;
}): Promise<{ deviceId: string; agentToken: string }> {
  const agentToken = randomBytes(32).toString("base64url");
  const deviceId = randomUUID();
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const enrollment = await tx.agentEnrollment.findFirst({
      where: {
        tokenHash: hashToken(input.token),
        expiresAt: { gt: now },
      },
      select: { id: true, userId: true },
    });
    if (!enrollment) {
      throw new InvalidEnrollmentTokenError(
        "Enrollment token is invalid, expired, or already used."
      );
    }
    const claimed = await tx.agentEnrollment.deleteMany({
      where: { id: enrollment.id, expiresAt: { gt: now } },
    });
    if (claimed.count !== 1) {
      throw new InvalidEnrollmentTokenError(
        "Enrollment token is invalid, expired, or already used."
      );
    }

    const monitoredRoot = normalizePath(input.monitoredRoot);
    await tx.device.create({
      data: {
        id: deviceId,
        userId: enrollment.userId,
        name: input.name,
        osName: input.osName,
        monitoredRoot,
        agentTokenHash: hashToken(agentToken),
        lastSeenAt: now,
      },
    });
  });

  return { deviceId, agentToken };
}

export async function revokeAgent(userId: string, deviceId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const revoked = await tx.device.updateMany({
      where: { id: deviceId, userId, agentTokenHash: { not: null } },
      data: { agentTokenHash: null },
    });
    if (revoked.count !== 1) return false;

    await tx.scan.updateMany({
      where: {
        deviceId,
        status: { in: ["queued", "running"] },
      },
      data: {
        status: "failed",
        completedAt: new Date(),
        agentLeaseUntil: null,
        errorMessage: "Agent access was revoked before this scan completed.",
      },
    });
    return true;
  });
}

export async function authenticateAgentToken(token: string) {
  const device = await prisma.device.findUnique({
    where: { agentTokenHash: hashToken(token) },
  });
  if (!device) return null;

  await prisma.device.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date() },
  });
  return device;
}

export async function claimNextAgentTask(deviceId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "devices" WHERE "id" = ${deviceId}::uuid FOR UPDATE`;
    const now = new Date();
    const activeTask = await tx.scan.findFirst({
      where: {
        deviceId,
        status: "running",
        agentLeaseUntil: { gt: now },
      },
      select: { id: true },
    });
    if (activeTask) return null;

    const expiredTask = await tx.scan.findFirst({
      where: {
        deviceId,
        status: "running",
        agentLeaseUntil: { lte: now },
      },
      orderBy: { startedAt: "asc" },
      select: { id: true, rootPath: true, triggerType: true },
    });
    const task =
      expiredTask ??
      (await tx.scan.findFirst({
        where: { deviceId, status: "queued" },
        orderBy: { startedAt: "asc" },
        select: { id: true, rootPath: true, triggerType: true },
      }));
    if (!task) return null;

    const claimed = await tx.scan.updateMany({
      where: {
        id: task.id,
        deviceId,
        OR: [
          { status: "queued" },
          { status: "running", agentLeaseUntil: { lte: now } },
        ],
      },
      data: {
        status: "running",
        startedAt: now,
        agentLeaseUntil: new Date(now.getTime() + 5 * 60 * 1000),
      },
    });
    return claimed.count === 1 ? task : null;
  });
}

export async function renewAgentTaskLease(
  deviceId: string,
  scanId: string
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "devices" WHERE "id" = ${deviceId}::uuid FOR UPDATE`;
    const renewed = await tx.scan.updateMany({
      where: { id: scanId, deviceId, status: "running" },
      data: { agentLeaseUntil: new Date(Date.now() + 5 * 60 * 1000) },
    });
    return renewed.count === 1;
  });
}

export class InvalidAgentScanResultError extends Error {}

export async function saveAgentScanResult(
  deviceId: string,
  scanId: string,
  result: AgentScanResult
): Promise<void> {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  const scan = await prisma.scan.findFirst({
    where: { id: scanId, deviceId, status: "running" },
  });
  if (!device || !scan) {
    throw new InvalidAgentScanResultError(
      "The scan is not active for this enrolled device."
    );
  }
  if (
    result.rootPath !== scan.rootPath ||
    (device.monitoredRoot !== null && result.rootPath !== device.monitoredRoot)
  ) {
    throw new InvalidAgentScanResultError(
      "The agent result root does not match the authorized scan root."
    );
  }

  const scanResult: ScanResult = {
    rootPath: result.rootPath,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    durationMs: result.durationMs,
    status: result.status,
    diskMetrics: result.diskMetrics
      ? {
          totalBytes: BigInt(result.diskMetrics.totalBytes),
          freeBytes: BigInt(result.diskMetrics.freeBytes),
        }
      : null,
    directories: result.directories.map((directory) => ({
      ...directory,
      sizeBytes: BigInt(directory.sizeBytes),
      filesCount:
        directory.filesCount === null ? null : BigInt(directory.filesCount),
      directoriesCount:
        directory.directoriesCount === null
          ? null
          : BigInt(directory.directoriesCount),
      errors: [],
    })),
    scannedDirectoryCount: result.scannedDirectoryCount,
    inaccessibleDirectoryCount: result.inaccessibleDirectoryCount,
    totalErrorCount: result.totalErrorCount,
    errorMessage: result.errorMessage,
  };

  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.scan.updateMany({
      where: { id: scanId, deviceId, status: "running" },
      data: {
        status: scanResult.status,
        startedAt: new Date(scanResult.startedAt),
        agentLeaseUntil: null,
        completedAt: new Date(scanResult.completedAt),
        totalBytes: scanResult.diskMetrics?.totalBytes.toString() ?? null,
        freeBytes: scanResult.diskMetrics?.freeBytes.toString() ?? null,
        scannedDirectoryCount: scanResult.scannedDirectoryCount,
        inaccessibleDirectoryCount:
          scanResult.inaccessibleDirectoryCount,
        errorMessage: scanResult.errorMessage,
      },
    });
    if (changed.count !== 1) return false;

    if (scanResult.directories.length > 0) {
      await tx.directorySnapshot.createMany({
        data: scanResult.directories.map((directory) => ({
          scanId,
          normalizedPath: directory.normalizedPath,
          displayName: directory.displayName,
          sizeBytes: directory.sizeBytes.toString(),
          filesCount: directory.filesCount?.toString() ?? null,
          directoriesCount: directory.directoriesCount?.toString() ?? null,
          measurementComplete: directory.measurementComplete,
        })),
      });
    }
    return true;
  });

  if (!updated) {
    throw new InvalidAgentScanResultError(
      "The scan result was already submitted or the scan is no longer active."
    );
  }

  if (scanResult.status === "completed" || scanResult.status === "partial") {
    const settings = await prisma.settings.findUniqueOrThrow({
      where: { userId: device.userId },
    });
    try {
      await generateFindings({
        userId: device.userId,
        scanId,
        deviceId,
        rootPath: scan.rootPath,
        scanResult,
        lowSpaceThresholdPercent: Number(
          settings.lowSpaceThresholdPercent
        ),
      });
    } catch (error) {
      console.error(
        `[findings] Error generating findings for agent scan ${scanId}:`,
        error
      );
    }
  }
}
