"use client";

import { useEffect, useState, useMemo } from "react";
import { Search, ArrowRight, Folder } from "lucide-react";
import { api, type Scan, type DirectoryChange } from "@/lib/api";
import { formatBytes, formatDelta, formatPercent, formatDate, cn } from "@/lib/utils";

type Filter = "all" | "increased" | "decreased" | "new" | "removed";
type SortKey = "delta" | "size" | "percent";

export default function DirectoryChangesPage() {
  const [scans, setScans] = useState<Scan[]>([]);
  const [baselineId, setBaselineId] = useState<string>("");
  const [currentId, setCurrentId] = useState<string>("");
  const [changes, setChanges] = useState<DirectoryChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("delta");

  useEffect(() => {
    api.scans.list().then((r) => {
      const completed = r.scans.filter((s) => s.status === "completed" || s.status === "partial");
      setScans(completed);
      if (completed.length >= 1) setCurrentId(completed[0]!.id);
      if (completed.length >= 2) setBaselineId(completed[1]!.id);
    }).catch((e: Error) => setLoadError(e.message)).finally(() => setLoading(false));
  }, []);

  const completedScans = useMemo(
    () => scans.filter((s) => s.status === "completed" || s.status === "partial"),
    [scans]
  );
  const baselineChoices = useMemo(() => {
    const current = completedScans.find((s) => s.id === currentId);
    if (!current) return [];
    return completedScans
      .filter((s) => s.id !== current.id && s.rootPath === current.rootPath && s.startedAt < current.startedAt)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }, [completedScans, currentId]);

  useEffect(() => {
    if (baselineChoices.some((s) => s.id === baselineId)) return;
    setBaselineId(baselineChoices[0]?.id ?? "");
  }, [baselineChoices, baselineId]);

  useEffect(() => {
    if (!currentId || loading || (baselineId && !baselineChoices.some((s) => s.id === baselineId))) return;
    let active = true;
    setComparisonLoading(true);
    setError("");
    api.scans.changes(currentId, baselineId || undefined)
      .then((r) => { if (active) setChanges(r.changes); })
      .catch((e: Error) => { if (active) { setChanges([]); setError(e.message); } })
      .finally(() => { if (active) setComparisonLoading(false); });
    return () => { active = false; };
  }, [currentId, baselineId, baselineChoices, loading]);

  const filtered = useMemo(() => {
    let list = changes;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((c) => c.normalizedPath.toLowerCase().includes(q));
    }
    if (filter !== "all") list = list.filter((c) => c.changeLabel === filter);
    return [...list].sort((a, b) => {
      if (sort === "delta") {
        const absDelta = (c: DirectoryChange) => {
          const delta = BigInt(c.deltaBytes);
          return delta < 0n ? -delta : delta;
        };
        const left = absDelta(a);
        const right = absDelta(b);
        return left > right ? -1 : left < right ? 1 : 0;
      }
      if (sort === "size") {
        const left = BigInt(a.currentSizeBytes);
        const right = BigInt(b.currentSizeBytes);
        return right > left ? 1 : right < left ? -1 : 0;
      }
      if (sort === "percent") {
        return Math.abs(b.percentChange ?? 0) - Math.abs(a.percentChange ?? 0);
      }
      return 0;
    });
  }, [changes, search, filter, sort]);

  return (
    <div className="p-6 space-y-6 max-w-[1200px]">
      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Storage Comparison</p>
        <h1 className="text-2xl font-semibold text-white">Directory changes</h1>
        <p className="text-sm text-gray-400 mt-0.5">Compare folder sizes between scans of the same monitored root.</p>
      </div>

      {/* Scan selectors */}
      <div className="bg-bg-card border border-border rounded-lg p-4 flex items-center gap-4">
        <div className="flex-1">
          <label className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1">Baseline Scan</label>
          <select
            value={baselineId}
            onChange={(e) => setBaselineId(e.target.value)}
            disabled={baselineChoices.length === 0}
            className="w-full bg-bg-page border border-border rounded px-3 py-2 text-sm text-white focus:border-accent outline-none"
          >
            <option value="">{baselineChoices.length ? "— select —" : "No earlier scan for this root"}</option>
            {baselineChoices.map((s) => (
              <option key={s.id} value={s.id}>{formatDate(s.startedAt)}</option>
            ))}
          </select>
        </div>
        <ArrowRight size={16} className="text-gray-500 mt-5 shrink-0" />
        <div className="flex-1">
          <label className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1">Current Scan</label>
          <select
            value={currentId}
            onChange={(e) => setCurrentId(e.target.value)}
            className="w-full bg-bg-page border border-border rounded px-3 py-2 text-sm text-white focus:border-accent outline-none"
          >
            <option value="">— select —</option>
            {completedScans.map((s) => (
              <option key={s.id} value={s.id}>{formatDate(s.startedAt)}</option>
            ))}
          </select>
        </div>
      </div>

      {loadError && <div role="alert" className="rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger">Could not load scan history: {loadError}</div>}
      {error && <div role="alert" className="rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger">Could not compare these scans: {error}</div>}

      {/* Filter/search row */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search directory paths"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-bg-card border border-border rounded px-3 py-2 pl-8 text-sm text-white placeholder:text-gray-600 focus:border-accent outline-none"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          className="bg-bg-card border border-border rounded px-3 py-2 text-sm text-white focus:border-accent outline-none"
        >
          <option value="all">All changes</option>
          <option value="increased">Grew</option>
          <option value="decreased">Shrank</option>
          <option value="new">New</option>
          <option value="removed">Removed</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="bg-bg-card border border-border rounded px-3 py-2 text-sm text-white focus:border-accent outline-none"
        >
          <option value="delta">Sort: largest change</option>
          <option value="size">Sort: by size</option>
          <option value="percent">Sort: by % change</option>
        </select>
      </div>

      {/* Table */}
      {loading || comparisonLoading ? (
        <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>
      ) : !currentId ? (
        <div className="text-sm text-gray-500 py-12 text-center">No completed scans yet. Run a scan to establish a baseline.</div>
      ) : baselineChoices.length === 0 ? (
        <div className="text-sm text-gray-500 py-12 text-center">This scan has no earlier completed scan for the same monitored root.</div>
      ) : error ? null : filtered.length === 0 ? (
        <div className="text-sm text-gray-500 py-12 text-center">
          {changes.length === 0
            ? "No comparable scan data yet. Run at least two scans."
            : "No results matching the current filter."}
        </div>
      ) : (
        <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_100px_100px_110px_80px] text-[10px] uppercase tracking-wider text-gray-500 border-b border-border px-4 py-2">
            <span>Directory Path</span>
            <span className="text-right">Previous</span>
            <span className="text-right">Current</span>
            <span className="text-right">Difference</span>
            <span className="text-right">Change</span>
          </div>
          {filtered.map((c) => {
            const pos = BigInt(c.deltaBytes) >= 0n;
            const deltaColor = !c.comparisonReliable ? "text-gray-400"
              : c.changeLabel === "new" ? "text-blue-400"
                : pos ? "text-delta-positive" : "text-delta-negative";
            return (
              <div
                key={c.normalizedPath}
                className="grid grid-cols-[1fr_100px_100px_110px_80px] px-4 py-3 border-b border-border/50 hover:bg-white/3 transition-colors items-center"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Folder size={12} className="text-gray-500 shrink-0" />
                  <span className="text-xs text-gray-200 truncate font-mono">{c.normalizedPath}</span>
                  {!c.comparisonReliable && (
                    <span className="text-[9px] text-warning border border-warning/30 rounded px-1">incomplete</span>
                  )}
                </div>
                <span className="text-xs text-gray-400 text-right tabular-nums">
                  {c.previousSizeBytes
                    ? `${c.previousComplete === false ? "≈ " : ""}${formatBytes(c.previousSizeBytes)}`
                    : "—"}
                </span>
                <span className="text-xs text-gray-200 text-right tabular-nums">
                  {c.changeLabel === "removed"
                    ? "Not observed"
                    : `${c.currentComplete ? "" : "≈ "}${formatBytes(c.currentSizeBytes)}`}
                </span>
                <span className={cn("text-xs font-semibold text-right tabular-nums", deltaColor)}>
                  {c.comparisonReliable ? formatDelta(c.deltaBytes) : "Uncertain"}
                </span>
                <span className={cn("text-xs font-medium text-right tabular-nums", deltaColor)}>
                  {c.comparisonReliable ? formatPercent(c.percentChange) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

