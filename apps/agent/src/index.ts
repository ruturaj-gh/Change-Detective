import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { scan, normalizePath, serializeScanResult } from "@change-detective/scanner";
import { z } from "zod";
import {
  createFileChangeMonitor,
  type FileChangeMonitor,
} from "./file-change-monitor.js";
import { LocalAgentStore, type PendingScan } from "./local-store.js";

const AgentConfigSchema = z.object({
  apiUrl: z.string().url(),
  deviceId: z.string().uuid(),
  agentToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  monitoredRoot: z.string().min(1),
});

const TaskSchema = z.object({
  scanIntervalMinutes: z.number().int().min(15).max(10080),
  task: z
    .object({
      scanId: z.string().uuid(),
      rootPath: z.string().min(1),
      triggerType: z.enum(["manual", "scheduled"]),
    })
    .nullable(),
  pollAfterSeconds: z.number().int().min(5).max(300),
});

type AgentConfig = z.infer<typeof AgentConfigSchema>;
type ScanTask = NonNullable<z.infer<typeof TaskSchema>["task"]>;

const CONFIG_BASE_DIR =
  process.env["XDG_CONFIG_HOME"] ??
  (process.platform === "win32"
    ? process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming")
    : join(homedir(), ".config"));
const CONFIG_DIR = join(CONFIG_BASE_DIR, "change-detective");
const CONFIG_FILE = join(CONFIG_DIR, "agent.json");

class AgentAuthenticationError extends Error {}
class AgentHttpError extends Error {
  constructor(readonly status: number) {
    super(`API request failed with HTTP ${status}.`);
  }
}

function normalizeApiUrl(value: string): string {
  const parsed = new URL(value);
  const isLoopback =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]";
  if (
    (parsed.protocol !== "https:" && !(isLoopback && parsed.protocol === "http:")) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new Error(
      "Agent URL must be an HTTPS origin (HTTP is allowed only for localhost)."
    );
  }
  return parsed.origin;
}

async function loadConfig(): Promise<AgentConfig> {
  try {
    const raw = await readFile(CONFIG_FILE, "utf8");
    const config = AgentConfigSchema.parse(JSON.parse(raw));
    if (!isAbsolute(config.monitoredRoot)) {
      throw new Error("Saved monitored root is not an absolute path for this operating system.");
    }
    if (process.platform !== "win32") await chmod(CONFIG_FILE, 0o600);
    return { ...config, apiUrl: normalizeApiUrl(config.apiUrl) };
  } catch (error) {
    if (
      !(error && typeof error === "object" && "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT")
    ) {
      throw error;
    }
  }

  const apiUrlValue = process.env["CD_API_URL"];
  const enrollmentToken = process.env["CD_ENROLLMENT_TOKEN"];
  const rootValue = process.env["CD_MONITORED_ROOT"];
  if (!apiUrlValue || !enrollmentToken || !rootValue) {
    throw new Error(
      "First run requires CD_API_URL, CD_ENROLLMENT_TOKEN, and CD_MONITORED_ROOT."
    );
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(enrollmentToken)) {
    throw new Error("The enrollment token has an invalid format.");
  }
  if (!isAbsolute(rootValue)) {
    throw new Error("CD_MONITORED_ROOT must be an absolute path for this operating system.");
  }

  const monitoredRoot = normalizePath(rootValue);
  const rootStat = await stat(monitoredRoot);
  if (!rootStat.isDirectory()) {
    throw new Error("CD_MONITORED_ROOT must point to an accessible directory.");
  }

  const apiUrl = normalizeApiUrl(apiUrlValue);
  const enrollment = await requestJson(
    apiUrl,
    "/api/agent/enroll",
    {
      method: "POST",
      body: {
        enrollmentToken,
        name: hostname(),
        osName: getAgentOsName(),
        monitoredRoot,
      },
    }
  );
  const enrolled = z
    .object({
      deviceId: z.string().uuid(),
      agentToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    })
    .parse(enrollment);

  const config = AgentConfigSchema.parse({
    apiUrl,
    deviceId: enrolled.deviceId,
    agentToken: enrolled.agentToken,
    monitoredRoot,
  });
  await saveConfig(config);
  delete process.env["CD_ENROLLMENT_TOKEN"];
  console.log(`Enrolled this ${getAgentOsName()} device (${config.deviceId}).`);
  return config;
}

function getAgentOsName(): string {
  if (
    process.platform === "android" ||
    process.env["PREFIX"]?.includes("com.termux")
  ) {
    return "Android (Termux)";
  }
  if (process.platform === "win32") return "Windows";
  if (process.platform === "darwin") return "macOS";
  return process.platform.charAt(0).toUpperCase() + process.platform.slice(1);
}

async function saveConfig(config: AgentConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(CONFIG_DIR, 0o700);
  const temporary = `${CONFIG_FILE}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(config, null, 2), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  try {
    await rename(temporary, CONFIG_FILE);
    if (process.platform !== "win32") await chmod(CONFIG_FILE, 0o600);
  } catch (error) {
    const { rm } = await import("node:fs/promises");
    await rm(temporary, { force: true });
    throw error;
  }
}

async function requestJson(
  apiUrl: string,
  endpoint: string,
  options: {
    method: "GET" | "POST";
    token?: string;
    body?: unknown;
  }
): Promise<unknown> {
  const response = await fetch(`${apiUrl}${endpoint}`, {
    method: options.method,
    redirect: "error",
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 401) {
    throw new AgentAuthenticationError(
      "Agent authentication failed. Revoke and re-enroll this device."
    );
  }
  if (!response.ok) {
    throw new AgentHttpError(response.status);
  }
  return response.json();
}

function resultPayload(result: Awaited<ReturnType<typeof scan>>) {
  const serialized = serializeScanResult(result);
  return {
    ...serialized,
    directories: serialized.directories.map(
      ({
        normalizedPath,
        displayName,
        sizeBytes,
        filesCount,
        directoriesCount,
        measurementComplete,
      }) => ({
        normalizedPath,
        displayName,
        sizeBytes,
        filesCount,
        directoriesCount,
        measurementComplete,
      })
    ),
  };
}

let stopping = false;
let activeScan: AbortController | null = null;
let wakeSleep: (() => void) | null = null;
const stopAgent = () => {
  stopping = true;
  activeScan?.abort();
  wakeSleep?.();
};

async function flushPending(
  config: AgentConfig,
  store: LocalAgentStore
): Promise<void> {
  for (const pending of store.listPending()) {
    const localPath =
      `/api/agent/scans/local/${encodeURIComponent(pending.scanId)}/results`;
    const taskPath =
      `/api/agent/scans/${encodeURIComponent(pending.scanId)}/results`;
    try {
      await requestJson(
        config.apiUrl,
        pending.source === "local" ? localPath : taskPath,
        {
          method: "POST",
          token: config.agentToken,
          body:
            pending.source === "local"
              ? { triggerType: pending.triggerType, result: pending.result }
              : pending.result,
        }
      );
      store.removePending(pending.scanId);
      console.log(`Synchronized scan ${pending.scanId}.`);
    } catch (error) {
      if (error instanceof AgentAuthenticationError) throw error;
      if (
        error instanceof AgentHttpError &&
        error.status < 500 &&
        error.status !== 408 &&
        error.status !== 429
      ) {
        console.error(
          `The API rejected scan ${pending.scanId} with HTTP ${error.status}; the result remains in SQLite and later queued scans will still be synchronized.`
        );
        continue;
      }
      console.error(
        `Could not synchronize scan ${pending.scanId}; it remains in the local queue:`,
        error instanceof Error ? error.message : "unknown error"
      );
      return;
    }
  }
}

function enqueueResult(
  store: LocalAgentStore,
  scanId: string,
  source: PendingScan["source"],
  triggerType: PendingScan["triggerType"],
  result: Awaited<ReturnType<typeof scan>>,
  nextScheduledAt?: number
): void {
  store.enqueue(
    {
      scanId,
      source,
      triggerType,
      result: resultPayload(result),
      createdAt: new Date().toISOString(),
    },
    nextScheduledAt
  );
}

async function executeTask(
  config: AgentConfig,
  store: LocalAgentStore,
  task: ScanTask
): Promise<void> {
  const taskRoot = normalizePath(task.rootPath);
  if (taskRoot !== config.monitoredRoot) {
    const now = new Date().toISOString();
    const result = {
      rootPath: taskRoot,
      startedAt: now,
      completedAt: now,
      durationMs: 0,
      status: "failed",
      diskMetrics: null,
      directories: [],
      scannedDirectoryCount: 0,
      inaccessibleDirectoryCount: 0,
      totalErrorCount: 0,
      errorMessage:
        "The requested root does not match the path approved in the local agent configuration.",
    } satisfies Awaited<ReturnType<typeof scan>>;
    enqueueResult(store, task.scanId, "task", task.triggerType, result);
    return;
  }

  const controller = new AbortController();
  activeScan = controller;
  const heartbeat = setInterval(() => {
    void requestJson(
      config.apiUrl,
      `/api/agent/scans/${encodeURIComponent(task.scanId)}/heartbeat`,
      { method: "POST", token: config.agentToken, body: {} }
    ).catch((error: unknown) => {
      if (error instanceof AgentAuthenticationError) {
        console.error(error.message);
        controller.abort();
        return;
      }
      console.warn(
        "Could not renew the scan task lease; the completed result will be queued for synchronization:",
        error instanceof Error ? error.message : "unknown error"
      );
    });
  }, 60_000);

  try {
    const result = await scan({
      rootPath: config.monitoredRoot,
      signal: controller.signal,
      meta: { scanId: task.scanId, triggerType: task.triggerType },
    });
    if (result.status !== "cancelled") {
      enqueueResult(store, task.scanId, "task", task.triggerType, result);
    }
  } finally {
    clearInterval(heartbeat);
    activeScan = null;
  }
}

async function executeLocalScan(
  config: AgentConfig,
  store: LocalAgentStore,
  triggerType: "scheduled" | "event",
  scanIntervalMinutes: number
): Promise<void> {
  if (!store.hasCapacityForScan()) {
    console.warn("Local scan skipped because the pending upload queue is near capacity.");
    return;
  }

  const scanId = randomUUID();
  const controller = new AbortController();
  activeScan = controller;
  try {
    const result = await scan({
      rootPath: config.monitoredRoot,
      signal: controller.signal,
      meta: { scanId, triggerType },
    });
    if (result.status === "cancelled" || stopping) return;

    const nextScheduledAt =
      triggerType === "scheduled"
        ? new Date(result.completedAt).getTime() + scanIntervalMinutes * 60_000
        : undefined;
    enqueueResult(
      store,
      scanId,
      "local",
      triggerType,
      result,
      nextScheduledAt
    );
    console.log(
      `${triggerType === "event" ? "Change-triggered" : "Periodic"} scan ${scanId} completed (${result.status}).`
    );
  } finally {
    activeScan = null;
  }
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wakeSleep = null;
      resolve();
    }, seconds * 1000);
    wakeSleep = () => {
      clearTimeout(timer);
      wakeSleep = null;
      resolve();
    };
  });
}

async function run(): Promise<void> {
  const config = await loadConfig();
  const store = new LocalAgentStore(CONFIG_DIR);
  const savedInterval = store.getScanIntervalMinutes();
  let scanIntervalMinutes = savedInterval ?? 360;
  let needsInitialInterval = savedInterval === null;
  let nextScheduledAt = store.getNextScheduledAt() ?? Date.now();
  let eventScanDue = false;
  let eventDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastEventScanAt = 0;
  const watcher: FileChangeMonitor | null = createFileChangeMonitor(
    config.monitoredRoot,
    () => {
      if (eventDebounceTimer) clearTimeout(eventDebounceTimer);
      eventDebounceTimer = setTimeout(() => {
        eventScanDue = true;
        wakeSleep?.();
      }, 30_000);
    },
    (error) => {
      const code =
        "code" in error ? String(error.code) : "unknown error";
      console.warn(
        "Filesystem event monitoring failed; periodic scans remain authoritative.",
        code
      );
    }
  );
  if (watcher) {
    console.log("Filesystem event monitoring is active.");
  }

  console.log(
    `${getAgentOsName()} agent ready to scan ${config.monitoredRoot}.`
  );

  process.on("SIGINT", stopAgent);
  process.on("SIGTERM", stopAgent);

  try {
    while (!stopping) {
      let delaySeconds = 30;
      let polledForTask = false;
      try {
        await flushPending(config, store);
      } catch (error) {
        if (error instanceof AgentAuthenticationError) throw error;
        console.error(
          "Could not read the local scan queue:",
          error instanceof Error ? error.message : "unknown error"
        );
      }

      if (stopping) break;
      if (needsInitialInterval && store.hasCapacityForScan()) {
        let initialResponse: z.infer<typeof TaskSchema> | null = null;
        try {
          initialResponse = TaskSchema.parse(
            await requestJson(config.apiUrl, "/api/agent/tasks/next", {
              method: "GET",
              token: config.agentToken,
            })
          );
        } catch (error) {
          if (error instanceof AgentAuthenticationError) throw error;
          console.error(
            "Could not load the initial scan schedule:",
            error instanceof Error ? error.message : "unknown error"
          );
          store.setScanIntervalMinutes(scanIntervalMinutes);
          nextScheduledAt = store.getNextScheduledAt() ?? Date.now();
          store.setNextScheduledAt(nextScheduledAt);
          needsInitialInterval = false;
        }
        if (initialResponse) {
          delaySeconds = initialResponse.pollAfterSeconds;
          scanIntervalMinutes = initialResponse.scanIntervalMinutes;
          store.setScanIntervalMinutes(scanIntervalMinutes);
          nextScheduledAt = store.getNextScheduledAt() ?? Date.now();
          store.setNextScheduledAt(nextScheduledAt);
          needsInitialInterval = false;
          polledForTask = true;
          if (initialResponse.task) {
            await executeTask(config, store, initialResponse.task);
            continue;
          }
        }
      }

      const now = Date.now();
      if (
        eventScanDue &&
        now < nextScheduledAt &&
        now - lastEventScanAt >= 5 * 60_000 &&
        store.hasCapacityForScan()
      ) {
        eventScanDue = false;
        await executeLocalScan(config, store, "event", scanIntervalMinutes);
        lastEventScanAt = Date.now();
        continue;
      }

      if (now >= nextScheduledAt && store.hasCapacityForScan()) {
        eventScanDue = false;
        await executeLocalScan(
          config,
          store,
          "scheduled",
          scanIntervalMinutes
        );
        nextScheduledAt =
          store.getNextScheduledAt() ??
          Date.now() + scanIntervalMinutes * 60_000;
        continue;
      }

      if (store.hasCapacityForScan() && !polledForTask) {
        try {
          const response = TaskSchema.parse(
            await requestJson(config.apiUrl, "/api/agent/tasks/next", {
              method: "GET",
              token: config.agentToken,
            })
          );
          delaySeconds = response.pollAfterSeconds;
          const previousInterval = store.getScanIntervalMinutes();
          const previousNextScan = store.getNextScheduledAt();
          if (previousInterval !== null && previousNextScan !== null) {
            const lastScheduledAt =
              previousNextScan - previousInterval * 60_000;
            nextScheduledAt =
              lastScheduledAt + response.scanIntervalMinutes * 60_000;
          }
          scanIntervalMinutes = response.scanIntervalMinutes;
          store.setScanIntervalMinutes(scanIntervalMinutes);
          if (previousNextScan !== null) {
            store.setNextScheduledAt(nextScheduledAt);
          }
          if (response.task) {
            await executeTask(config, store, response.task);
            continue;
          }
        } catch (error) {
          if (error instanceof AgentAuthenticationError) throw error;
          console.error(
            "Agent request failed:",
            error instanceof Error ? error.message : "unknown error"
          );
        }
      } else {
        console.warn(
          "Agent upload queue is at capacity; new scans and task polling are paused until synchronization succeeds."
        );
      }

      if (!stopping) {
        await sleep(Math.max(5, Math.min(300, delaySeconds)));
      }
    }
  } finally {
    if (eventDebounceTimer) clearTimeout(eventDebounceTimer);
    watcher?.close();
    store.close();
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Agent stopped unexpectedly.");
  process.exitCode = 1;
});
