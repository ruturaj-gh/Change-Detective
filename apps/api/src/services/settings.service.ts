/**
 * Settings service — get and update the single local settings row.
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

export async function getSettings() {
  return prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
}

export async function updateSettings(patch: SettingsPatch) {
  if (patch.monitoredRoot !== undefined) {
    if (!path.isAbsolute(patch.monitoredRoot)) {
      throw new InvalidMonitoredRootError("The monitored root must be an absolute path for this operating system.");
    }
    if (process.env["SCAN_MODE"] !== "agent") {
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
      where: { id: 1 },
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

    if (
      process.env["SCAN_MODE"] === "agent" &&
      patch.monitoredRoot !== undefined
    ) {
      await tx.device.updateMany({
        where: { agentTokenHash: { not: null } },
        data: { monitoredRoot: updated.monitoredRoot },
      });
      await tx.scan.updateMany({
        where: {
          device: { is: { agentTokenHash: { not: null } } },
          status: { in: ["queued", "running"] },
        },
        data: {
          status: "failed",
          completedAt: new Date(),
          agentLeaseUntil: null,
          errorMessage:
            "The monitored root changed before this scan completed.",
        },
      });
    }
    return updated;
  });
}

