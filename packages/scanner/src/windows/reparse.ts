/**
 * Windows reparse-point detection.
 *
 * Node.js `lstat` + `isSymbolicLink()` catches POSIX symlinks and some
 * Windows reparse points, but NOT all junction types on older Windows
 * builds. We use the `Dirent.isSymbolicLink()` check as the primary
 * guard, which on Windows covers:
 *   - NTFS symbolic links (mklink)
 *   - NTFS junctions (mklink /J)
 *   - Mount points
 *
 * Reference: Node.js fs.Dirent documentation and Windows NTFS reparse points.
 * https://nodejs.org/api/fs.html#fsopendirpath-options-callback
 *
 * We do NOT follow any of these by default. If a directory entry reports
 * isSymbolicLink() === true, we skip it and record a note (not an error).
 *
 * Known limitation: On some Windows configurations, `opendir` with
 * `{ recursive: false }` may not always expose reparse-point status via
 * `Dirent.isSymbolicLink()` for every reparse tag. We apply a belt-and-
 * suspenders approach: also check lstat attributes when we can.
 */

import { lstat } from "node:fs/promises";
import type { Dirent } from "node:fs";

/**
 * Returns true if the directory entry should be skipped because it is a
 * reparse point (symlink, junction, mount point).
 *
 * Falls back to an `lstat` check when the Dirent flag is ambiguous.
 */
export async function isReparsePoint(
  dirent: Dirent,
  fullPath: string
): Promise<boolean> {
  // Fast path: Dirent already knows it's a symlink/junction.
  if (dirent.isSymbolicLink()) {
    return true;
  }

  // Belt-and-suspenders: lstat to catch reparse points that Dirent
  // reports as regular directories on some Windows builds.
  try {
    const stat = await lstat(fullPath);
    // On Windows, junctions appear as directories but lstat reveals the
    // symlink flag.
    return stat.isSymbolicLink();
  } catch {
    // If we cannot stat, we conservatively treat it as NOT a reparse point
    // so the caller handles the actual traversal error.
    return false;
  }
}

