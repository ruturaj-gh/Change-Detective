import { watch, type FSWatcher } from "node:fs";

export interface FileChangeMonitor {
  close(): void;
}

export function createFileChangeMonitor(
  rootPath: string,
  onChange: () => void,
  onError: (error: Error) => void
): FileChangeMonitor | null {
  let watcher: FSWatcher;
  try {
    watcher = watch(
      rootPath,
      { recursive: true, persistent: false },
      () => onChange()
    );
  } catch (error) {
    onError(error instanceof Error ? error : new Error("Filesystem watch failed."));
    return null;
  }

  watcher.on("error", (error: Error) => {
    onError(error);
    watcher.close();
  });
  return { close: () => watcher.close() };
}
