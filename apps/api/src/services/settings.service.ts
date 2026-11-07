/**
 * Settings service — get and update the single local settings row.
 */
import { prisma } from "../db/client.js";
import { z } from "zod";
import { stat } from "node:fs/promises";
import path from "node:path";

export const SettingsPatchSchema = z.object({
  monitoredRoot: z.string().trim().min(1).optional(),
  scanIntervalMinutes: z.number().int().min(15).max(10080).optional(),
  lowSpaceThresholdPercent: z.number().min(0).max(100).optional(),
  historyRetentionDays: z.number().int().min(1).max(3650).optional(),
});

export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export class InvalidMonitoredRootError extends Error {}

export async function getSettings() {
  return prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
}

export async function updateSettings(patch: SettingsPatch) {
  if (patch.monitoredRoot !== undefined) {
    if (!path.win32.isAbsolute(patch.monitoredRoot)) {
      throw new InvalidMonitoredRootError("The monitored root must be an absolute Windows path.");
    }
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

  return prisma.settings.update({
    where: { id: 1 },
    data: {
      ...(patch.monitoredRoot !== undefined && {
        monitoredRoot: patch.monitoredRoot,
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
}

