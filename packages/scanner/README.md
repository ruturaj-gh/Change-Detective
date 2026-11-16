# @change-detective/scanner

Isolated cross-platform filesystem scanner for the Change Detective project.

## Purpose

Scans a configured root directory on Linux or Windows, recursively measuring the logical file sizes of each immediate child directory. Produces a structured `ScanResult` with coverage flags, timing, and optional disk metrics.

## Design principles

- **No database, API, or network dependencies.** This package is purely filesystem I/O.
- **`bigint` arithmetic.** All byte counts are `bigint` internally. At JSON boundaries, they serialize as decimal strings to avoid silent precision loss.
- **No symlink following.** Symbolic links are detected and skipped to prevent cycles and double-counting.
- **Incremental traversal.** Uses an explicit stack instead of recursion; never holds the entire directory tree in memory.
- **Graceful error handling.** Permission errors and file disappearance during scanning mark the affected measurement incomplete rather than crashing.
- **Cancellation support.** Accepts an `AbortSignal` for cooperative cancellation.

## Usage

```typescript
import { scan, serializeScanResult } from "@change-detective/scanner";

const result = await scan({
  rootPath: "/home/user",
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

- **Symlink detection:** The test gracefully skips itself when symlink creation is not permitted. Production scanning skips symbolic links using `Dirent.isSymbolicLink()` + `lstat`.
- **Disk metrics:** Uses `fs.statfs` (Node 19+) and returns `null` when filesystem metrics are unavailable.
- **Logical file size only:** Reports `stat.size` (logical file size), not allocated disk blocks. Filesystem overhead, sparse files, and compression mean directory totals will not equal drive-used space.
- **No file contents or hashes:** By design. The scanner never opens file contents.

## Files

| File | Purpose |
|---|---|
| `src/types.ts` | All TypeScript types and JSON serialization helpers |
| `src/scanner.ts` | Main `scan()` function and traversal logic |
| `src/windows/reparse.ts` | Symlink/reparse-point detection |
| `src/windows/diskspace.ts` | Filesystem capacity metrics adapter |
| `tests/scanner.test.ts` | Vitest test suite |

