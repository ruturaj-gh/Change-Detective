/**
 * Typed API client — all calls go through the Next.js rewrite to 127.0.0.1:3001
 * so the API key / DB credentials never touch the browser.
 */

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export interface Account {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  privacyNoticeVersion: string | null;
  privacyAcceptedAt: string | null;
  createdAt: string;
  deviceCount: number;
  scanCount: number;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!res.ok) {
    let responseBody: unknown;
    try {
      responseBody = await res.json();
    } catch {
      throw new Error(`POST ${path} → ${res.status}`);
    }
    if (
      responseBody !== null &&
      typeof responseBody === "object" &&
      "message" in responseBody &&
      typeof responseBody.message === "string"
    ) {
      throw new Error(responseBody.message);
    }
    throw new Error(`POST ${path} → ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function del<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "DELETE",
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
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
  monitoredRoot?: string | null;
  isAgent: boolean;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface AgentPairingRequest {
  status: "pending" | "completed" | "expired";
  name?: string;
  osName?: string;
  monitoredRoot?: string;
  expiresAt?: string;
}

export interface Scan {
  id: string;
  deviceId: string;
  rootPath: string;
  triggerType: "manual" | "scheduled" | "event";
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
  auth: {
    session: async (): Promise<{
      authenticated: boolean;
      authenticationEnabled: boolean;
      user?: { id: string; email: string };
    }> => {
      const res = await fetch(`${BASE}/auth/session`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (res.status === 401) {
        return { authenticated: false, authenticationEnabled: true };
      }
      if (!res.ok) {
        throw new Error(`Could not check sign-in status (${res.status}).`);
      }
      return res.json();
    },
    logout: () => post<{ authenticated: boolean }>("/auth/logout"),
  },
  account: {
    get: () => get<{ account: Account }>("/account"),
    delete: (confirmation: "DELETE") =>
      del<{ deleted: boolean }>("/account", { confirmation }),
  },

  agents: {
    pairing: (id: string) =>
      get<{ pairing: AgentPairingRequest }>(
        `/agents/pairings/${encodeURIComponent(id)}`
      ),
    approvePairing: (id: string) =>
      post<{ approved: boolean }>(
        `/agents/pairings/${encodeURIComponent(id)}/approve`
      ),
    revoke: (id: string) =>
      del<{ revoked: boolean }>(`/agents/${encodeURIComponent(id)}`),
  },

  health: () => get<HealthResponse>("/health"),

  devices: () =>
    get<{ devices: Device[]; scanMode: "local" | "agent" }>("/devices"),
  updateDeviceRoot: (id: string, monitoredRoot: string) =>
    patch<{ updated: boolean }>(
      `/devices/${encodeURIComponent(id)}/root`,
      { monitoredRoot }
    ),

  scans: {
    list: () => get<{ scans: Scan[] }>("/scans"),
    get: (id: string) => get<{ scan: Scan }>(`/scans/${id}`),
    start: (deviceId?: string) =>
      post<{ scanId: string; status: string }>(
        "/scans",
        deviceId ? { deviceId } : undefined
      ),
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

