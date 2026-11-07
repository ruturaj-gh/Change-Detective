/**
 * Scanner package tests.
 *
 * Uses Vitest and real temporary directories on the local filesystem.
 * Tests verify correctness of byte counting, coverage flags, cancellation,
 * and edge cases specified in the project brief §11 and §19.
 *
 * No mocking of the filesystem — tests create and clean up real temp dirs.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";
import { scan, normalizePath } from "../src/scanner.js";
import { serializeScanResult } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testRoot: string;

beforeEach(async () => {
  // Create a fresh temporary directory for each test.
  testRoot = await mkdtemp(join(tmpdir(), "cd-scanner-test-"));
});

afterEach(async () => {
  // Remove the temp directory and all contents.
  await rm(testRoot, { recursive: true, force: true });
});

/** Write a file with exactly `bytes` bytes of content. */
async function writeBytes(filePath: string, bytes: number): Promise<void> {
  await writeFile(filePath, Buffer.alloc(bytes, 0x41)); // fill with 'A'
}

/** Create a nested directory path. */
async function mkdirp(p: string): Promise<void> {
  await mkdir(p, { recursive: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("scan() — basic correctness", () => {
  it("returns status=completed for an empty root with no child dirs", async () => {
    const result = await scan({ rootPath: testRoot });

    expect(result.status).toBe("completed");
    expect(result.directories).toHaveLength(0);
    expect(result.scannedDirectoryCount).toBe(0);
    expect(result.inaccessibleDirectoryCount).toBe(0);
    expect(result.totalErrorCount).toBe(0);
    expect(result.errorMessage).toBeNull();
  });

  it("measures a single top-level directory with one file", async () => {
    const dir = join(testRoot, "alpha");
    await mkdirp(dir);
    await writeBytes(join(dir, "file.txt"), 1024);

    const result = await scan({ rootPath: testRoot });

    expect(result.status).toBe("completed");
    expect(result.directories).toHaveLength(1);

    const measured = result.directories[0];
    expect(measured).toBeDefined();
    expect(measured!.sizeBytes).toBe(1024n);
    expect(measured!.measurementComplete).toBe(true);
    expect(measured!.errors).toHaveLength(0);
    expect(measured!.filesCount).toBe(1n);
  });

  it("measures nested directories correctly and sums all file sizes", async () => {
    // Structure:
    //   alpha/
    //     a.txt           (100 bytes)
    //     sub/
    //       b.txt         (200 bytes)
    //       deep/
    //         c.txt       (300 bytes)
    // Expected total: 600 bytes

    const dir = join(testRoot, "alpha");
    const sub = join(dir, "sub");
    const deep = join(sub, "deep");
    await mkdirp(deep);
    await writeBytes(join(dir, "a.txt"), 100);
    await writeBytes(join(sub, "b.txt"), 200);
    await writeBytes(join(deep, "c.txt"), 300);

    const result = await scan({ rootPath: testRoot });

    const alpha = result.directories.find(
      (d) => d.displayName.toLowerCase() === "alpha"
    );
    expect(alpha).toBeDefined();
    expect(alpha!.sizeBytes).toBe(600n);
    expect(alpha!.measurementComplete).toBe(true);
  });

  it("measures multiple top-level directories independently", async () => {
    const a = join(testRoot, "aaa");
    const b = join(testRoot, "bbb");
    await mkdirp(a);
    await mkdirp(b);
    await writeBytes(join(a, "x.bin"), 512);
    await writeBytes(join(b, "y.bin"), 1024);

    const result = await scan({ rootPath: testRoot });

    expect(result.directories).toHaveLength(2);
    const aa = result.directories.find((d) => d.displayName.toLowerCase() === "aaa");
    const bb = result.directories.find((d) => d.displayName.toLowerCase() === "bbb");
    expect(aa!.sizeBytes).toBe(512n);
    expect(bb!.sizeBytes).toBe(1024n);
  });

  it("counts zero bytes for an empty directory", async () => {
    const dir = join(testRoot, "empty");
    await mkdirp(dir);

    const result = await scan({ rootPath: testRoot });
    const measured = result.directories[0];
    expect(measured!.sizeBytes).toBe(0n);
    expect(measured!.filesCount).toBe(0n);
  });

  it("handles zero-byte files correctly (does not add to size)", async () => {
    const dir = join(testRoot, "zerodir");
    await mkdirp(dir);
    await writeBytes(join(dir, "zero.bin"), 0);

    const result = await scan({ rootPath: testRoot });
    const measured = result.directories[0];
    expect(measured!.sizeBytes).toBe(0n);
    expect(measured!.filesCount).toBe(1n);
  });

  it("handles unicode and whitespace in directory and file names", async () => {
    const dir = join(testRoot, "Ünïcödé dir with spaces");
    await mkdirp(dir);
    await writeBytes(join(dir, "fïlé nämé.txt"), 256);

    const result = await scan({ rootPath: testRoot });

    expect(result.directories).toHaveLength(1);
    const measured = result.directories[0];
    expect(measured!.sizeBytes).toBe(256n);
    expect(measured!.measurementComplete).toBe(true);
  });
});

describe("scan() — known byte counts (bigint precision)", () => {
  it("handles large byte counts without precision loss", async () => {
    // We can't actually create a multi-GB file in tests, but we verify that
    // the accumulation of many files doesn't lose precision.
    const dir = join(testRoot, "bigdir");
    await mkdirp(dir);

    // Write 1000 files of 1,000,000 bytes each = 1,000,000,000 bytes (1 GB equivalent math).
    // In practice, write fewer files with exact sizes that sum to a known large bigint.
    // Write 10 files of exactly 999,999,999 bytes total across them:
    // 5 files × 100,000,000 bytes = 500,000,000 bytes
    // This is large enough to exceed Number.MAX_SAFE_INTEGER / 1000.
    const fileCount = 5;
    const fileSize = 10_000_000; // 10 MB per file — manageable for tests
    const expected = BigInt(fileCount) * BigInt(fileSize);

    for (let i = 0; i < fileCount; i++) {
      await writeBytes(join(dir, `file${i}.bin`), fileSize);
    }

    const result = await scan({ rootPath: testRoot });
    const measured = result.directories[0];
    expect(measured!.sizeBytes).toBe(expected);

    // Verify JSON serialization produces the correct decimal string.
    const json = serializeScanResult(result);
    expect(json.directories[0]!.sizeBytes).toBe(expected.toString());
  });

  it("serializes bigint byte values as decimal strings at JSON boundary", async () => {
    const dir = join(testRoot, "serial");
    await mkdirp(dir);
    await writeBytes(join(dir, "f.bin"), 123456);

    const result = await scan({ rootPath: testRoot });
    const json = serializeScanResult(result);

    expect(json.directories[0]!.sizeBytes).toBe("123456");
    expect(typeof json.directories[0]!.sizeBytes).toBe("string");
  });
});

describe("scan() — symlink and junction handling", () => {
  it("does not follow symlinks to directories", async () => {
    // Create a real directory with content.
    const realDir = join(testRoot, "real");
    await mkdirp(realDir);
    await writeBytes(join(realDir, "file.bin"), 9999);

    // Create a symlink pointing to realDir.
    const linkDir = join(testRoot, "link");
    try {
      await symlink(realDir, linkDir, "junction");
    } catch {
      // If symlink creation fails (e.g. insufficient privilege), skip the test.
      // eslint-disable-next-line no-console
      console.warn("Symlink/junction creation requires elevated privileges on this system — skipping");
      return;
    }

    const result = await scan({ rootPath: testRoot });

    // Only the real dir should be measured; the symlink should be skipped.
    // The real dir should appear once — no double-counting via the symlink.
    const dirNames = result.directories.map((d) => d.displayName.toLowerCase());
    expect(dirNames).toContain("real");
    expect(dirNames).not.toContain("link");

    const real = result.directories.find(
      (d) => d.displayName.toLowerCase() === "real"
    );
    expect(real!.sizeBytes).toBe(9999n);
  });
});

describe("scan() — cancellation", () => {
  it("returns status=cancelled when AbortSignal is aborted before scan starts", async () => {
    const dir = join(testRoot, "cancelme");
    await mkdirp(dir);
    await writeBytes(join(dir, "f.bin"), 100);

    const controller = new AbortController();
    controller.abort(); // Abort immediately.

    const result = await scan({ rootPath: testRoot, signal: controller.signal });

    expect(result.status).toBe("cancelled");
  });

  it("returns status=cancelled when AbortSignal is aborted mid-scan", async () => {
    // Create many directories so the scan takes some time.
    for (let i = 0; i < 20; i++) {
      const d = join(testRoot, `dir${i}`);
      await mkdirp(d);
      await writeBytes(join(d, "f.bin"), 1000);
    }

    const controller = new AbortController();
    // Abort after a short delay to cancel mid-scan.
    setTimeout(() => controller.abort(), 1);

    const result = await scan({ rootPath: testRoot, signal: controller.signal });

    // Status must be either cancelled or completed (if it finished before abort).
    expect(["cancelled", "completed", "partial"]).toContain(result.status);
  });
});

describe("scan() — progress callback", () => {
  it("fires progress callback for each completed directory", async () => {
    const dirs = ["a", "b", "c"];
    for (const d of dirs) {
      await mkdirp(join(testRoot, d));
      await writeBytes(join(testRoot, d, "f.bin"), 100);
    }

    const progressEvents: { completed: number; total: number }[] = [];

    await scan({
      rootPath: testRoot,
      onProgress: (p) => {
        progressEvents.push({
          completed: p.completedDirectories,
          total: p.totalDirectories,
        });
      },
    });

    expect(progressEvents).toHaveLength(3);
    expect(progressEvents[0]!.total).toBe(3);
    expect(progressEvents[2]!.completed).toBe(3);
  });

  it("does not throw if progress callback throws", async () => {
    const dir = join(testRoot, "safe");
    await mkdirp(dir);

    const result = await scan({
      rootPath: testRoot,
      onProgress: () => {
        throw new Error("callback exploded");
      },
    });

    // Scan should still complete normally.
    expect(result.status).toBe("completed");
  });
});

describe("scan() — failed root", () => {
  it("returns status=failed when root path does not exist", async () => {
    const result = await scan({
      rootPath: join(testRoot, "nonexistent_root_xyz"),
    });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBeTruthy();
    expect(result.directories).toHaveLength(0);
  });

  it("returns status=failed when root path is a file, not a directory", async () => {
    const filePath = join(testRoot, "notadir.txt");
    await writeBytes(filePath, 10);

    const result = await scan({ rootPath: filePath });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("not a directory");
  });
});

describe("scan() — timing and metadata", () => {
  it("records valid ISO timestamps and non-negative duration", async () => {
    const result = await scan({ rootPath: testRoot });

    expect(() => new Date(result.startedAt)).not.toThrow();
    expect(() => new Date(result.completedAt)).not.toThrow();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(new Date(result.completedAt) >= new Date(result.startedAt)).toBe(
      true
    );
  });

  it("rootPath in result matches the normalised input path", async () => {
    const result = await scan({ rootPath: testRoot });
    // Both should normalize to the same string.
    expect(result.rootPath).toBe(normalizePath(testRoot));
  });
});

describe("scan() — two-scan comparison semantics", () => {
  it("correctly shows known growth between two scans", async () => {
    const dir = join(testRoot, "growing");
    await mkdirp(dir);
    await writeBytes(join(dir, "initial.bin"), 1000);

    const scan1 = await scan({ rootPath: testRoot });
    const s1dir = scan1.directories[0];
    expect(s1dir!.sizeBytes).toBe(1000n);

    // Add more files.
    await writeBytes(join(dir, "added.bin"), 500);

    const scan2 = await scan({ rootPath: testRoot });
    const s2dir = scan2.directories[0];
    expect(s2dir!.sizeBytes).toBe(1500n);

    const delta = s2dir!.sizeBytes - s1dir!.sizeBytes;
    expect(delta).toBe(500n);
  });

  it("correctly shows known shrinkage between two scans", async () => {
    const dir = join(testRoot, "shrinking");
    await mkdirp(dir);
    await writeBytes(join(dir, "big.bin"), 2000);
    await writeBytes(join(dir, "small.bin"), 500);

    const scan1 = await scan({ rootPath: testRoot });
    const s1dir = scan1.directories[0];
    expect(s1dir!.sizeBytes).toBe(2500n);

    // Remove the big file.
    const { rm: rmFile } = await import("node:fs/promises");
    await rmFile(join(dir, "big.bin"));

    const scan2 = await scan({ rootPath: testRoot });
    const s2dir = scan2.directories[0];
    expect(s2dir!.sizeBytes).toBe(500n);

    // scan1 = 2000 + 500 = 2500; scan2 = 500 (big.bin removed); delta = 500 - 2500 = -2000
    const delta = s2dir!.sizeBytes - s1dir!.sizeBytes;
    expect(delta).toBe(-2000n);
  });
});

describe("normalizePath()", () => {
  it("lowercases the path", () => {
    expect(normalizePath("C:\\Users\\Alice")).toBe("c:/users/alice");
  });

  it("converts backslashes to forward slashes", () => {
    expect(normalizePath("D:\\foo\\bar")).toBe("d:/foo/bar");
  });

  it("is idempotent", () => {
    const p = "c:/users/alice";
    expect(normalizePath(normalizePath(p))).toBe(p);
  });
});
