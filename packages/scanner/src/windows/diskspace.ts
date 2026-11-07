/**
 * Windows disk-space adapter.
 *
 * Uses Node.js `fs.statfs` (available from Node 19+) to retrieve total
 * and free bytes for the filesystem containing the given path.
 *
 * Falls back to a PowerShell invocation when statfs is not available.
 * The PowerShell path is isolated here so it can be replaced or removed
 * without touching the main scanner.
 */

import { statfs } from "node:fs/promises";
import type { DiskMetrics } from "../types.js";

/**
 * Returns drive-level total and free bytes for the filesystem at `rootPath`.
 * Returns null if the information cannot be retrieved (non-fatal; caller
 * records null and continues).
 */
export async function getDiskMetrics(
  rootPath: string
): Promise<DiskMetrics | null> {
  try {
    const stats = await statfs(rootPath);
    // statfs returns blocks; multiply by block size for bytes.
    // bsize is the fundamental block size.
    const totalBytes = BigInt(stats.blocks) * BigInt(stats.bsize);
    const freeBytes = BigInt(stats.bfree) * BigInt(stats.bsize);
    return { totalBytes, freeBytes };
  } catch (primaryError) {
    // statfs may not be available on all Node versions or may fail on
    // certain Windows drives (e.g. network paths). Try PowerShell fallback.
    try {
      return await getDiskMetricsViaPowerShell(rootPath);
    } catch {
      // Both methods failed; return null so the scan continues without
      // disk metrics. The caller marks diskMetrics as null.
      return null;
    }
  }
}

/**
 * PowerShell fallback for disk metrics.
 *
 * Invokes Get-PSDrive for the drive letter of rootPath.
 * SECURITY: We derive the drive letter from the validated rootPath;
 * we do NOT pass user-controlled strings into the PowerShell command.
 */
async function getDiskMetricsViaPowerShell(
  rootPath: string
): Promise<DiskMetrics | null> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  // Extract the drive letter (e.g. "C" from "C:\").
  const driveLetter = rootPath.match(/^([A-Za-z]):/)?.[1];
  if (!driveLetter) {
    return null;
  }

  // Parameterize the drive letter; no shell interpolation of user data.
  const script = `
    $d = Get-PSDrive -Name '${driveLetter.toUpperCase()}' -ErrorAction Stop
    Write-Output "$($d.Used + $d.Free) $($d.Free)"
  `.trim();

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NonInteractive", "-NoProfile", "-Command", script],
    { timeout: 10_000 }
  );

  const parts = stdout.trim().split(/\s+/);
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;

  try {
    const totalBytes = BigInt(parts[0]);
    const freeBytes = BigInt(parts[1]);
    return { totalBytes, freeBytes };
  } catch {
    return null;
  }
}

