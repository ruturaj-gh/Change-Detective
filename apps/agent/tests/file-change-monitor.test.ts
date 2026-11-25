import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createFileChangeMonitor } from "../src/file-change-monitor.js";

describe("cross-platform file change monitor", () => {
  it("signals changes below the approved root without exposing filenames", async () => {
    const root = mkdtempSync(join(tmpdir(), "change-detective-watch-"));
    const nested = join(root, "nested");
    mkdirSync(nested);

    let resolveChange: (() => void) | null = null;
    let rejectChange: ((error: Error) => void) | null = null;
    const change = new Promise<void>((resolve, reject) => {
      resolveChange = resolve;
      rejectChange = reject;
    });
    const monitor = createFileChangeMonitor(
      root,
      () => resolveChange?.(),
      (error) => rejectChange?.(error)
    );

    const timeout = setTimeout(
      () => rejectChange?.(new Error("No filesystem change signal was received.")),
      5000
    );
    try {
      assert.ok(monitor, "the current platform should support recursive watches");
      writeFileSync(join(nested, "signal.txt"), "changed");
      await change;
    } finally {
      clearTimeout(timeout);
      monitor?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
