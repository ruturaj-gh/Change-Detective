import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { scan, normalizePath, serializeScanResult } from "@change-detective/scanner";
import { z } from "zod";

const AgentConfigSchema = z.object({
  apiUrl: z.string().url(),
  deviceId: z.string().uuid(),
  agentToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  monitoredRoot: z.string().min(1),
});

const TaskSchema = z.object({
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
    throw new Error(`API request failed with HTTP ${response.status}.`);
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

async function submitResult(
  config: AgentConfig,
  scanId: string,
  result: Awaited<ReturnType<typeof scan>>
): Promise<void> {
  await requestJson(
    config.apiUrl,
    `/api/agent/scans/${encodeURIComponent(scanId)}/results`,
    {
      method: "POST",
      token: config.agentToken,
      body: resultPayload(result),
    }
  );
}

let stopping = false;
let activeScan: AbortController | null = null;
const stopAgent = () => {
  stopping = true;
  activeScan?.abort();
};

async function executeTask(config: AgentConfig, task: ScanTask): Promise<void> {
  const taskRoot = normalizePath(task.rootPath);
  if (taskRoot !== config.monitoredRoot) {
    const now = new Date().toISOString();
    await submitResult(config, task.scanId, {
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
    });
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
      console.error(
        "Could not renew the scan task lease:",
        error instanceof Error ? error.message : "unknown error"
      );
      controller.abort();
    });
  }, 60_000);

  try {
    const result = await scan({
      rootPath: config.monitoredRoot,
      signal: controller.signal,
      meta: { scanId: task.scanId, triggerType: task.triggerType },
    });
    await submitResult(config, task.scanId, result);
  } finally {
    clearInterval(heartbeat);
    activeScan = null;
  }
}

async function run(): Promise<void> {
  const config = await loadConfig();
  console.log(
    `${getAgentOsName()} agent ready to scan ${config.monitoredRoot}.`
  );

  process.on("SIGINT", stopAgent);
  process.on("SIGTERM", stopAgent);

  while (!stopping) {
    let delaySeconds = 15;
    try {
      const response = TaskSchema.parse(
        await requestJson(config.apiUrl, "/api/agent/tasks/next", {
          method: "GET",
          token: config.agentToken,
        })
      );
      delaySeconds = response.pollAfterSeconds;
      if (response.task) {
        await executeTask(config, response.task);
        delaySeconds = 5;
      }
    } catch (error) {
      if (error instanceof AgentAuthenticationError) throw error;
      console.error(
        "Agent request failed:",
        error instanceof Error ? error.message : "unknown error"
      );
    }

    if (!stopping) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(5, Math.min(300, delaySeconds)) * 1000)
      );
    }
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Agent stopped unexpectedly.");
  process.exitCode = 1;
});
