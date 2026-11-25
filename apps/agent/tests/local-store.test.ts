import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  LocalAgentStore,
  type PendingScan,
} from "../src/local-store.js";

const temporaryDirectories: string[] = [];

function createStore(): LocalAgentStore {
  const directory = mkdtempSync(join(tmpdir(), "change-detective-agent-"));
  temporaryDirectories.push(directory);
  return new LocalAgentStore(directory);
}

function pendingScan(scanId: string): PendingScan {
  return {
    scanId,
    source: "local",
    triggerType: "scheduled",
    result: { rootPath: "/approved/root", status: "completed" },
    createdAt: "2026-11-24T05:00:00.000Z",
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("local agent store", () => {
  it("persists pending results and schedule state across restarts", () => {
    const first = createStore();
    const scanId = "00000000-0000-4000-8000-000000000001";
    first.enqueue(pendingScan(scanId), 1_800_000_000_000);
    first.setScanIntervalMinutes(120);
    first.close();

    const second = new LocalAgentStore(temporaryDirectories[0]!);
    assert.deepEqual(second.listPending(), [pendingScan(scanId)]);
    assert.equal(second.getScanIntervalMinutes(), 120);
    assert.equal(second.getNextScheduledAt(), 1_800_000_000_000);
    second.close();
  });

  it("treats identical result retries as idempotent and rejects scan ID reuse", () => {
    const store = createStore();
    const scan = pendingScan("00000000-0000-4000-8000-000000000002");
    store.enqueue(scan);
    store.enqueue(scan);
    assert.equal(store.listPending().length, 1);
    assert.throws(
      () => store.enqueue({ ...scan, result: { status: "different" } }),
      /cannot be reused/
    );
    store.close();
  });

  it("rejects malformed queued records and invalid intervals", () => {
    const store = createStore();
    assert.throws(
      () => store.enqueue({ ...pendingScan("not-a-uuid") }),
      /valid uuid/
    );
    assert.throws(() => store.setScanIntervalMinutes(1), /supported range/);
    store.close();
  });
});
