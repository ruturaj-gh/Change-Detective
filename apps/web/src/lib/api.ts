/**
 * Typed API client — all calls go through the Next.js rewrite to 127.0.0.1:3001
 * so the API key / DB credentials never touch the browser.
 */

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface HealthResponse {
  api: "ok" | "error";
  database: "ok" | "error";
  timestamp: string;
  databaseError?: string;
}

export interface Device {
  id: string;
  name: string;
  osName: string;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface Scan {
  id: string;
  deviceId: string;
  rootPath: string;
  triggerType: "manual" | "scheduled";
  status: "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";
  startedAt: string;
  completedAt: string | null;
  totalBytes: string | null;
  freeBytes: string | null;
  scannedDirectoryCount: number;
  inaccessibleDirectoryCount: number;
  errorMessage: string | null;
  _count?: { directories: number };
}

export interface DirectorySnapshot {
  scanId: string;
  normalizedPath: string;
  displayName: string;
  sizeBytes: string;
  filesCount: string | null;
  directoriesCount: string | null;
  measurementComplete: boolean;
}

export interface DirectoryChange {
  normalizedPath: string;
  displayName: string;
  currentSizeBytes: string;
  previousSizeBytes: string | null;
  deltaBytes: string;
  percentChange: number | null;
  changeLabel: "increased" | "decreased" | "unchanged" | "new" | "removed";
  currentComplete: boolean;
  previousComplete: boolean | null;
  comparisonReliable: boolean;
}

export interface Finding {
  id: string;
  deviceId: string;
  scanId: string | null;
  findingType: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  createdAt: string;
  resolvedAt: string | null;
  scan?: { rootPath: string; startedAt: string } | null;
}

export interface Settings {
  id: number;
  monitoredRoot: string;
  scanIntervalMinutes: number;
  lowSpaceThresholdPercent: string;
  historyRetentionDays: number;
  updatedAt: string;
}

export interface SettingsUpdate {
  monitoredRoot?: string;
  scanIntervalMinutes?: number;
  lowSpaceThresholdPercent?: number;
  historyRetentionDays?: number;
}

// ── API calls ──────────────────────────────────────────────────────────────

export const api = {
  health: () => get<HealthResponse>("/health"),

  devices: () => get<{ devices: Device[] }>("/devices"),

  scans: {
    list: () => get<{ scans: Scan[] }>("/scans"),
    get: (id: string) => get<{ scan: Scan }>(`/scans/${id}`),
    start: () => post<{ scanId: string; status: string }>("/scans"),
    directories: (id: string) =>
      get<{ directories: DirectorySnapshot[] }>(`/scans/${id}/directories`),
    changes: (id: string, previousScanId?: string) =>
      get<{
        currentScan: Scan;
        previousScan: Scan | null;
        changes: DirectoryChange[];
        isBaseline: boolean;
      }>(`/scans/${id}/changes${previousScanId ? `?previousScanId=${encodeURIComponent(previousScanId)}` : ""}`),
  },

  findings: {
    list: () => get<{ findings: Finding[] }>("/findings"),
  },

  settings: {
    get: () => get<{ settings: Settings }>("/settings"),
    update: (input: SettingsUpdate) =>
      patch<{ settings: Settings }>("/settings", input),
  },
};

