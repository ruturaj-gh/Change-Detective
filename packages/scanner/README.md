# @change-detective/scanner

Isolated Windows filesystem scanner for the Change Detective project.

## Purpose

Scans a configured root directory, recursively measuring the logical file sizes of each immediate child directory. Produces a structured `ScanResult` with coverage flags, timing, and optional disk metrics.

## Design principles

- **No database, API, or network dependencies.** This package is purely filesystem I/O.
- **`bigint` arithmetic.** All byte counts are `bigint` internally. At JSON boundaries, they serialize as decimal strings to avoid silent precision loss.
- **No symlink/junction following.** Windows reparse points (junctions, symlinks) are detected and skipped to prevent cycles and double-counting.
- **Incremental traversal.** Uses an explicit stack instead of recursion; never holds the entire directory tree in memory.
- **Graceful error handling.** Permission errors and file disappearance during scanning mark the affected measurement incomplete rather than crashing.
- **Cancellation support.** Accepts an `AbortSignal` for cooperative cancellation.

## Usage

```typescript
import { scan, serializeScanResult } from "@change-detective/scanner";

const result = await scan({
  rootPath: "C:\\",
  onProgress: (p) => console.log(`${p.completedDirectories}/${p.totalDirectories}`),
});

// result.status: "completed" | "partial" | "failed" | "cancelled"
// result.directories[n].sizeBytes is a bigint

// For API/JSON serialization (decimal strings for byte values):
const jsonSafe = serializeScanResult(result);
```

## Running tests

```bash
npm test
```

## Known limitations

- **Symlink/junction detection:** Requires administrator privileges to create symlinks/junctions for the symlink-skip test. The test gracefully skips itself when it cannot create the link. Production scanning skips reparse points using `Dirent.isSymbolicLink()` + `lstat` belt-and-suspenders check.
- **Disk metrics:** Uses `fs.statfs` (Node 19+) with a PowerShell fallback. Will return `null` on unsupported configurations rather than crashing.
- **Logical file size only:** Reports `stat.size` (logical file size), not allocated disk blocks. Filesystem overhead, sparse files, and compression mean directory totals will not equal drive-used space.
- **No file contents or hashes:** By design. The scanner never opens file contents.

## Files

| File | Purpose |
|---|---|
| `src/types.ts` | All TypeScript types and JSON serialization helpers |
| `src/scanner.ts` | Main `scan()` function and traversal logic |
| `src/windows/reparse.ts` | Windows reparse-point detection |
| `src/windows/diskspace.ts` | Drive-level disk metrics adapter |
| `tests/scanner.test.ts` | Vitest test suite |

