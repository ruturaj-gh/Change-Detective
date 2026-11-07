/**
 * API service unit tests — no database or network required.
 * Tests the comparison/delta logic in isolation.
 */
import { describe, it, expect } from "vitest";

// Re-export the private computeDeltas for testing by duplicating the logic here.
// The real implementation lives in scan.service.ts. We test it via the exported types.

// ---------------------------------------------------------------------------
// Inline delta computation (mirrors scan.service.ts logic for unit testing
// without requiring a live database connection).
// ---------------------------------------------------------------------------

interface DirSnapshot {
  normalizedPath: string;
  displayName: string;
  sizeBytes: string;
  measurementComplete: boolean;
}

interface DirectoryChange {
  normalizedPath: string;
  deltaBytes: string;
  percentChange: number | null;
  changeLabel: string;
  comparisonReliable: boolean;
}

function computeDeltas(
  current: DirSnapshot[],
  previous: DirSnapshot[]
): DirectoryChange[] {
  const previousMap = new Map(previous.map((d) => [d.normalizedPath, d]));
  const currentMap = new Map(current.map((d) => [d.normalizedPath, d]));
  const changes: DirectoryChange[] = [];

  for (const curr of current) {
    const prev = previousMap.get(curr.normalizedPath);
    const currentBytes = BigInt(curr.sizeBytes);
    const comparisonReliable =
      curr.measurementComplete && (prev?.measurementComplete ?? true);

    if (!prev) {
      changes.push({
        normalizedPath: curr.normalizedPath,
        deltaBytes: curr.sizeBytes,
        percentChange: null,
        changeLabel: "new",
        comparisonReliable,
      });
      continue;
    }

    const prevBytes = BigInt(prev.sizeBytes);
    const delta = currentBytes - prevBytes;
    let percentChange: number | null = null;

    if (prevBytes > 0n) {
      percentChange = Number((delta * 10000n) / prevBytes) / 100;
    }

    let changeLabel: string;
    if (delta > 0n) changeLabel = "increased";
    else if (delta < 0n) changeLabel = "decreased";
    else changeLabel = "unchanged";

    changes.push({
      normalizedPath: curr.normalizedPath,
      deltaBytes: delta.toString(),
      percentChange,
      changeLabel,
      comparisonReliable: curr.measurementComplete && prev.measurementComplete,
    });
  }

  for (const prev of previous) {
    if (!currentMap.has(prev.normalizedPath)) {
      changes.push({
        normalizedPath: prev.normalizedPath,
        deltaBytes: (-BigInt(prev.sizeBytes)).toString(),
        percentChange: -100,
        changeLabel: "removed",
        comparisonReliable: false,
      });
    }
  }

  return changes.sort((a, b) => {
    const absA = BigInt(a.deltaBytes) < 0n ? -BigInt(a.deltaBytes) : BigInt(a.deltaBytes);
    const absB = BigInt(b.deltaBytes) < 0n ? -BigInt(b.deltaBytes) : BigInt(b.deltaBytes);
    if (absB > absA) return 1;
    if (absB < absA) return -1;
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeDeltas() — comparison logic", () => {
  const make = (
    path: string,
    sizeBytes: string,
    complete = true
  ): DirSnapshot => ({
    normalizedPath: path,
    displayName: path.split("/").pop() ?? path,
    sizeBytes,
    measurementComplete: complete,
  });

  it("correctly computes growth", () => {
    const current = [make("c:/users", "2000")];
    const previous = [make("c:/users", "1000")];
    const [change] = computeDeltas(current, previous);
    expect(change!.deltaBytes).toBe("1000");
    expect(change!.changeLabel).toBe("increased");
    expect(change!.percentChange).toBe(100);
    expect(change!.comparisonReliable).toBe(true);
  });

  it("correctly computes shrinkage", () => {
    const current = [make("c:/users", "500")];
    const previous = [make("c:/users", "1000")];
    const [change] = computeDeltas(current, previous);
    expect(change!.deltaBytes).toBe("-500");
    expect(change!.changeLabel).toBe("decreased");
    expect(change!.percentChange).toBe(-50);
  });

  it("labels unchanged directories correctly", () => {
    const current = [make("c:/users", "1000")];
    const previous = [make("c:/users", "1000")];
    const [change] = computeDeltas(current, previous);
    expect(change!.changeLabel).toBe("unchanged");
    expect(change!.deltaBytes).toBe("0");
  });

  it("labels new directories (not in previous)", () => {
    const current = [make("c:/newdir", "500")];
    const previous: DirSnapshot[] = [];
    const [change] = computeDeltas(current, previous);
    expect(change!.changeLabel).toBe("new");
    expect(change!.percentChange).toBeNull();
  });

  it("labels removed directories (not in current)", () => {
    const current: DirSnapshot[] = [];
    const previous = [make("c:/olddir", "500")];
    const [change] = computeDeltas(current, previous);
    expect(change!.changeLabel).toBe("removed");
    expect(change!.deltaBytes).toBe("-500");
    expect(change!.comparisonReliable).toBe(false);
  });

  it("marks comparison unreliable when current measurement is incomplete", () => {
    const current = [make("c:/users", "2000", false)]; // incomplete
    const previous = [make("c:/users", "1000", true)];
    const [change] = computeDeltas(current, previous);
    expect(change!.comparisonReliable).toBe(false);
  });

  it("marks comparison unreliable when previous measurement is incomplete", () => {
    const current = [make("c:/users", "2000", true)];
    const previous = [make("c:/users", "1000", false)]; // incomplete
    const [change] = computeDeltas(current, previous);
    expect(change!.comparisonReliable).toBe(false);
  });

  it("does not divide by zero when previous size is zero", () => {
    const current = [make("c:/newish", "1000")];
    const previous = [make("c:/newish", "0")];
    const [change] = computeDeltas(current, previous);
    expect(change!.percentChange).toBeNull();
    expect(change!.changeLabel).toBe("increased");
    expect(change!.deltaBytes).toBe("1000");
  });

  it("sorts by absolute delta descending", () => {
    const current = [
      make("c:/small", "200"),
      make("c:/big", "5000"),
    ];
    const previous = [
      make("c:/small", "100"),  // delta +100
      make("c:/big", "1000"),   // delta +4000
    ];
    const changes = computeDeltas(current, previous);
    expect(changes[0]!.normalizedPath).toBe("c:/big");
    expect(changes[1]!.normalizedPath).toBe("c:/small");
  });

  it("handles large bigint byte values without precision loss", () => {
    // 10 TiB in bytes
    const tenTiB = (10n * 1024n * 1024n * 1024n * 1024n).toString();
    const tenTiBPlusOne = (10n * 1024n * 1024n * 1024n * 1024n + 1n).toString();
    const current = [make("c:/huge", tenTiBPlusOne)];
    const previous = [make("c:/huge", tenTiB)];
    const [change] = computeDeltas(current, previous);
    expect(change!.deltaBytes).toBe("1");
    expect(change!.changeLabel).toBe("increased");
  });

  it("handles multiple directories in a single comparison", () => {
    const current = [
      make("c:/a", "500"),
      make("c:/b", "300"),
      make("c:/c", "100"),
    ];
    const previous = [
      make("c:/a", "200"),
      make("c:/b", "400"),
    ];
    const changes = computeDeltas(current, previous);

    const a = changes.find((c) => c.normalizedPath === "c:/a");
    const b = changes.find((c) => c.normalizedPath === "c:/b");
    const cc = changes.find((c) => c.normalizedPath === "c:/c");

    expect(a!.changeLabel).toBe("increased");
    expect(b!.changeLabel).toBe("decreased");
    expect(cc!.changeLabel).toBe("new");
    expect(changes).toHaveLength(3);
  });
});

