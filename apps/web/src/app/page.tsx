"use client";

import { useEffect, useState, useCallback } from "react";
import { ScanLine, Folder, ChevronRight, Settings as SettingsIcon } from "lucide-react";
import Link from "next/link";
import { api, type Scan, type Finding, type DirectorySnapshot, type DirectoryChange, type Settings, type Device } from "@/lib/api";
import { StatCard } from "@/components/ui/StatCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { StorageHistoryChart } from "@/components/overview/StorageHistoryChart";
import { ScanCoverageDonut } from "@/components/overview/ScanCoverageDonut";
import { formatBytes, formatDate, formatDuration, formatDelta, formatPercent, usedPercent, getGreeting, formatCount, cn } from "@/lib/utils";

// ─── Scan-now button ──────────────────────────────────────────────────────────

function ScanNowButton({ devices, scanMode, onScanStarted, onScanUpdated }: { devices: Device[]; scanMode: "local" | "agent"; onScanStarted: () => void; onScanUpdated: (scan: Scan) => void }) {
  const [scanning, setScanning] = useState(false);
  const [scanId, setScanId] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<Scan | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const eligibleDevices = devices.filter((device) =>
    scanMode === "agent" ? device.isAgent : !device.isAgent
  );

  useEffect(() => {
    if (!eligibleDevices.some((device) => device.id === selectedDeviceId)) {
      setSelectedDeviceId(eligibleDevices[0]?.id ?? "");
    }
  }, [eligibleDevices, selectedDeviceId]);

  const startScan = useCallback(async () => {
    try {
      const res = await api.scans.start(selectedDeviceId || undefined);
      setScanId(res.scanId);
      setScanning(true);
      setScanStatus(null);
      onScanStarted();
    } catch (e) {
      alert((e as Error).message);
    }
  }, [onScanStarted, selectedDeviceId]);

  // Poll while scanning
  useEffect(() => {
    if (!scanId || !scanning) return;
    const iv = setInterval(async () => {
      try {
        const { scan } = await api.scans.get(scanId);
        setScanStatus(scan);
        onScanUpdated(scan);
        const done = scan.status !== "queued" && scan.status !== "running";
        if (done) {
          setScanning(false);
          setScanId(null);
          onScanStarted();
          clearInterval(iv);
        } else {
          // The API persists a measured-directory checkpoint every few folders.
        }
      } catch {
        clearInterval(iv);
        setScanning(false);
        onScanStarted();
      }
    }, 1500);
    return () => clearInterval(iv);
  }, [scanId, scanning, onScanStarted, onScanUpdated]);

  if (scanning) {
    return (
      <button disabled className="flex items-center gap-2 bg-accent/20 border border-accent text-accent text-sm px-4 py-2 rounded-lg font-medium">
        <span className="animate-pulse">⊡</span>
        {scanStatus?.status === "queued"
          ? "Scan queued…"
          : `Scanning · ${formatCount(scanStatus?.scannedDirectoryCount ?? 0)} top-level directories measured`}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {eligibleDevices.length > 1 && (
        <select
          aria-label="Scanning device"
          value={selectedDeviceId}
          onChange={(event) => setSelectedDeviceId(event.target.value)}
          className="rounded border border-border bg-bg-card px-3 py-2 text-xs text-white"
        >
          {eligibleDevices.map((device) => (
            <option key={device.id} value={device.id}>{device.name} · {device.osName}</option>
          ))}
        </select>
      )}
      <button
        onClick={() => void startScan()}
        disabled={!eligibleDevices.length}
        title={!eligibleDevices.length ? "Add a scanning device in Settings first." : undefined}
        className="flex items-center gap-2 bg-accent hover:bg-accent/80 text-black text-sm px-4 py-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ScanLine size={14} />
        {eligibleDevices.length ? "Scan now" : "Add a device in Settings"}
      </button>
    </div>
  );
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ScanProgressBar({ scan }: { scan: Scan }) {
  if (scan.status !== "running" && scan.status !== "queued") return null;
  return (
    <div className="mx-6 mt-2 bg-bg-card border border-border rounded-lg px-4 py-2 flex items-center gap-3">
      <div className="flex-1">
        <div className="text-xs text-gray-300 font-mono">
          Scanning {scan.rootPath} · {formatCount(scan.scannedDirectoryCount)} top-level directories measured
        </div>
        <div className="mt-1.5 progress-bar">
        <div className="progress-bar-indeterminate" />
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const [latestScan, setLatestScan] = useState<Scan | null>(null);
  const [latestSnapshotScan, setLatestSnapshotScan] = useState<Scan | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [dirs, setDirs] = useState<DirectorySnapshot[]>([]);
  const [changes, setChanges] = useState<DirectoryChange[]>([]);
  const [hasComparableBaseline, setHasComparableBaseline] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanMode, setScanMode] = useState<"local" | "agent">("local");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadData = useCallback(async () => {
    setLoadError("");
    try {
      const [scansRes, findingsRes, settingsRes, devicesRes] = await Promise.all([
        api.scans.list(),
        api.findings.list(),
        api.settings.get(),
        api.devices(),
      ]);

      setScans(scansRes.scans);
      setFindings(findingsRes.findings);
      setSettings(settingsRes.settings);
      setDevices(devicesRes.devices);
      setScanMode(devicesRes.scanMode);

      const latest = scansRes.scans[0] ?? null;
      setLatestScan(latest);
      const latestSnapshot = scansRes.scans.find((s) => s.status === "completed" || s.status === "partial") ?? null;
      setLatestSnapshotScan(latestSnapshot);

      if (latestSnapshot?.id) {
        const [dirsRes, changesRes] = await Promise.all([
          api.scans.directories(latestSnapshot.id),
          api.scans.changes(latestSnapshot.id),
        ]);
        setDirs(dirsRes.directories);
        setChanges(changesRes.changes);
        setHasComparableBaseline(!changesRes.isBaseline);
      } else {
        setDirs([]);
        setChanges([]);
        setHasComparableBaseline(false);
      }
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);
  const refreshOverview = useCallback(() => { void loadData(); }, [loadData]);

  // Build chart data from scan history
  const chartData = scans
    .filter((s) => s.totalBytes && s.freeBytes)
    .slice(0, 20)
    .reverse()
    .map((s) => ({
      date: new Date(s.startedAt).toLocaleDateString([], { month: "short", day: "numeric" }),
      usedBytes: s.totalBytes && s.freeBytes
        ? Number(BigInt(s.totalBytes) - BigInt(s.freeBytes))
        : 0,
      freeBytes: s.freeBytes ? Number(s.freeBytes) : 0,
    }));

  // Stat card values
  const usedPct = usedPercent(latestSnapshotScan?.totalBytes ?? null, latestSnapshotScan?.freeBytes ?? null);
  const totalFree = latestSnapshotScan?.freeBytes ? formatBytes(latestSnapshotScan.freeBytes) : "—";
  const totalDisk = latestSnapshotScan?.totalBytes ? formatBytes(latestSnapshotScan.totalBytes) : "—";
  const freePercent = latestSnapshotScan?.totalBytes && latestSnapshotScan.freeBytes && BigInt(latestSnapshotScan.totalBytes) > 0n
    ? Number((BigInt(latestSnapshotScan.freeBytes) * 10000n) / BigInt(latestSnapshotScan.totalBytes)) / 100
    : null;
  const lowSpaceThreshold = Number(settings?.lowSpaceThresholdPercent ?? 10);
  const showLowSpaceWarning = latestSnapshotScan?.id === latestScan?.id && freePercent !== null && freePercent < lowSpaceThreshold;

  // Net change since last scan
  const netDelta = changes.reduce((acc, c) => acc + BigInt(c.deltaBytes), 0n);
  const netDeltaStr = netDelta >= 0n ? `+${formatBytes(netDelta.toString())}` : `-${formatBytes((-netDelta).toString())}`;
  const comparisonIncomplete = changes.some((change) => !change.comparisonReliable);
  const netChangeValue = !latestSnapshotScan
    ? "—"
    : !hasComparableBaseline
      ? "Baseline"
      : comparisonIncomplete
        ? "Uncertain"
        : netDeltaStr;
  const netChangeLabel = !latestSnapshotScan
    ? "Run a scan to establish a baseline"
    : !hasComparableBaseline
      ? "First comparable scan"
      : comparisonIncomplete
        ? "At least one directory could not be compared exactly"
        : "Measured net storage change";
  const grew = changes.filter((c) => c.changeLabel === "increased").length;
  const shrank = changes.filter((c) => c.changeLabel === "decreased").length;

  // Monitoring card
  const intervalMins = settings?.scanIntervalMinutes ?? 360;

  // Top directories (by size)
  const topDirs = dirs.slice(0, 4);

  // Recent findings
  const recentFindings = findings.slice(0, 3);

  const greeting = getGreeting();
  const updateScanStatus = useCallback((scan: Scan) => setLatestScan(scan), []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        <div className="text-center space-y-2">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">System Overview</p>
          <h1 className="text-2xl font-semibold text-white">{greeting}</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {latestScan?.status === "queued" || latestScan?.status === "running"
              ? "A scan is running. Progress counts completed top-level directory measurements."
              : latestScan && !["completed", "partial"].includes(latestScan.status)
                ? "The latest scan did not complete. Showing the last completed measurements, if available."
                : latestSnapshotScan
                  ? "Here's what changed since the previous comparable scan."
                  : "No scans yet — run your first scan to get started."}
          </p>
        </div>
        <ScanNowButton devices={devices} scanMode={scanMode} onScanStarted={refreshOverview} onScanUpdated={updateScanStatus} />
      </div>

      {loadError && <div role="alert" className="rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger">The local API or database could not be reached. Start the API and check its database connection, then refresh. {loadError}</div>}
      {showLowSpaceWarning && <div role="alert" className="rounded border border-warning/40 bg-warning/5 p-3 text-sm text-warning">Free space is {freePercent?.toFixed(2)}% on {latestSnapshotScan?.rootPath}, below your configured {lowSpaceThreshold}% threshold.</div>}

      {/* Scan progress bar */}
      {latestScan && <ScanProgressBar scan={latestScan} />}

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Drive capacity"
          value={totalDisk}
          sub={latestSnapshotScan ? `${totalFree} free · measured ${formatDate(latestSnapshotScan.startedAt)}` : "Capacity data unavailable"}
          bar={usedPct}
          className="col-span-1"
        />
        <StatCard
          label="Since Last Scan"
          value={netChangeValue}
          sub={hasComparableBaseline && !comparisonIncomplete ? `${netChangeLabel} · ${grew} grew · ${shrank} shrank` : netChangeLabel}
        />
        <StatCard
          label="Last Scan"
          value={latestScan ? formatDate(latestScan.startedAt).split(" at ")[0]! : "Never"}
          {...(latestScan ? { sub: `at ${formatDate(latestScan.startedAt).split(" at ")[1] ?? ""} · ${formatDuration(latestScan.startedAt, latestScan.completedAt)}` } : {})}
          {...(latestScan ? { badge: (
            <div className="mt-1 flex items-center gap-2">
              <StatusBadge status={latestScan.status} />
              <span className="text-[10px] text-gray-500">{formatCount(latestScan.scannedDirectoryCount)} dirs</span>
            </div>
          ) } : {})}
        />
        <StatCard
          label="Monitoring"
          value={latestScan ? "Active" : "Idle"}
          sub={`Every ${intervalMins >= 60 ? `${intervalMins / 60} hours` : `${intervalMins} min`}`}
          action={
            <Link href="/settings" className="text-[10px] text-accent hover:underline flex items-center gap-0.5">
              <SettingsIcon size={9} /> Configure
            </Link>
          }
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="rounded-lg border border-border bg-bg-card p-4 lg:col-span-3">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-white">Storage history</span>
            <div className="flex items-center gap-3 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-accent inline-block" /> Used</span>
              <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-gray-600 inline-block" /> Free</span>
            </div>
          </div>
          <StorageHistoryChart data={chartData} />
        </div>

        <div className="rounded-lg border border-border bg-bg-card p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-white">Scan coverage</span>
            {latestSnapshotScan && (
              <span className="text-accent text-sm font-bold">
                {latestSnapshotScan.scannedDirectoryCount === 0 ? "—" :
                  `${Math.round(((latestSnapshotScan.scannedDirectoryCount - latestSnapshotScan.inaccessibleDirectoryCount) / latestSnapshotScan.scannedDirectoryCount) * 100)}%`}
              </span>
            )}
          </div>
          {latestSnapshotScan ? (
            <ScanCoverageDonut
              scanned={latestSnapshotScan.scannedDirectoryCount}
              incomplete={latestSnapshotScan.inaccessibleDirectoryCount}
            />
          ) : (
            <p className="text-xs text-gray-500">No scan data.</p>
          )}
        </div>
      </div>

      {/* Largest dirs + Recent findings */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Largest directories */}
        <div className="bg-bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-white">Largest directories</span>
            <Link href="/directory-changes" className="text-[10px] text-accent hover:underline flex items-center gap-0.5">
              View all <ChevronRight size={10} />
            </Link>
          </div>
          {topDirs.length === 0 ? (
            <p className="text-xs text-gray-500">No directory data. Run a scan first.</p>
          ) : (
            <div className="space-y-2">
              {topDirs.map((d) => {
                const maxBytes = topDirs[0] ? Number(topDirs[0].sizeBytes) : 1;
                const pct = (Number(d.sizeBytes) / maxBytes) * 100;
                return (
                  <div key={d.normalizedPath} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Folder size={11} className="text-gray-500 shrink-0" />
                        <span className="text-xs text-gray-300 truncate font-mono">{d.normalizedPath}</span>
                      </div>
                      <span className="text-xs text-white tabular-nums ml-2 shrink-0">{formatBytes(d.sizeBytes)}</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent findings */}
        <div className="bg-bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-white">Recent findings</span>
            <Link href="/findings" className="text-[10px] text-accent hover:underline flex items-center gap-0.5">
              View all <ChevronRight size={10} />
            </Link>
          </div>
          {recentFindings.length === 0 ? (
            <p className="text-xs text-gray-500">No findings yet.</p>
          ) : (
            <div className="space-y-2">
              {recentFindings.map((f) => {
                const ev = f.evidence as Record<string, unknown>;
                const delta = ev["deltaBytes"] ? formatDelta(ev["deltaBytes"] as string) : null;
                const icon = f.severity === "critical" ? "✕" : f.severity === "warning" ? "⚠" : "ℹ";
                const iconColor = f.severity === "critical" ? "text-danger" : f.severity === "warning" ? "text-warning" : "text-blue-400";
                return (
                  <Link key={f.id} href={`/findings/${f.id}`} className="flex items-start justify-between gap-2 p-2 rounded border border-border hover:border-accent/30 hover:bg-white/3 transition-colors group">
                    <div className="flex items-start gap-2 min-w-0">
                      <span className={cn("text-sm mt-0.5 shrink-0", iconColor)}>{icon}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-white truncate">{f.title}</p>
                        <p className="text-[10px] text-gray-500 truncate font-mono">
                          {(ev["normalizedPath"] ?? ev["displayName"]) as string ?? ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {delta && (
                        <span className={cn("text-xs font-semibold tabular-nums", Number(ev["deltaBytes"]) >= 0 ? "text-delta-positive" : "text-delta-negative")}>
                          {delta}
                        </span>
                      )}
                      <ChevronRight size={10} className="text-gray-600 group-hover:text-accent transition-colors" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

