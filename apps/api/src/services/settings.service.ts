/**
 * Settings service — get and update account-specific settings.
 */
import { prisma } from "../db/client.js";
import { z } from "zod";
import { stat } from "node:fs/promises";
import path from "node:path";
import { normalizePath } from "@change-detective/scanner";

export const SettingsPatchSchema = z.object({
  monitoredRoot: z.string().trim().min(1).optional(),
  scanIntervalMinutes: z.number().int().min(15).max(10080).optional(),
  lowSpaceThresholdPercent: z.number().min(0).max(100).optional(),
  historyRetentionDays: z.number().int().min(1).max(3650).optional(),
});

export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export class InvalidMonitoredRootError extends Error {}

export async function getSettings(userId: string) {
  return prisma.settings.findUniqueOrThrow({ where: { userId } });
}

export async function updateSettings(userId: string, patch: SettingsPatch) {
  if (patch.monitoredRoot !== undefined) {
    const agentMode = process.env["SCAN_MODE"] === "agent";
    const absolute =
      path.isAbsolute(patch.monitoredRoot) ||
      (agentMode &&
        path.win32.isAbsolute(patch.monitoredRoot) &&
        (/^[A-Za-z]:[\\/]/.test(patch.monitoredRoot) ||
          patch.monitoredRoot.startsWith("\\\\")));
    if (!absolute) {
      throw new InvalidMonitoredRootError("The monitored root must be an absolute path for this operating system.");
    }
    if (!agentMode) {
      let rootStat;
      try {
        rootStat = await stat(patch.monitoredRoot);
      } catch {
        throw new InvalidMonitoredRootError("The monitored root does not exist or cannot be accessed.");
      }
      if (!rootStat.isDirectory()) {
        throw new InvalidMonitoredRootError("The monitored root must be a directory.");
      }
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.settings.update({
      where: { userId },
      data: {
        ...(patch.monitoredRoot !== undefined && {
          monitoredRoot: normalizePath(patch.monitoredRoot),
        }),
        ...(patch.scanIntervalMinutes !== undefined && {
          scanIntervalMinutes: patch.scanIntervalMinutes,
        }),
        ...(patch.lowSpaceThresholdPercent !== undefined && {
          lowSpaceThresholdPercent: patch.lowSpaceThresholdPercent,
        }),
        ...(patch.historyRetentionDays !== undefined && {
          historyRetentionDays: patch.historyRetentionDays,
        }),
        updatedAt: new Date(),
      },
    });
    if (patch.monitoredRoot !== undefined && process.env["SCAN_MODE"] !== "agent") {
      await tx.device.updateMany({
        where: { userId, agentTokenHash: null },
        data: { monitoredRoot: updated.monitoredRoot },
      });
    }
    return updated;
  });
}

