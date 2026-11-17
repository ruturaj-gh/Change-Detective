"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type Scan } from "@/lib/api";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatDate, formatDuration, formatCount } from "@/lib/utils";

export default function ScanHistoryPage() {
  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.scans.list().then((r) => setScans(r.scans))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return <div className="max-w-[1200px] space-y-5 p-4 sm:p-6">
    <header><p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">History</p><h1 className="text-2xl font-semibold">Scan history</h1><p className="text-sm text-gray-400 mt-1">Recent snapshots for this device.</p></header>
    {loading ? <p className="text-sm text-gray-500 py-8 text-center">Loading scans…</p> : error ? <div role="alert" className="rounded border border-danger/30 bg-danger/5 p-4 text-sm text-danger">Could not load scan history. Check that the local API and database are available. {error}</div> : scans.length === 0 ? <div className="rounded-lg border border-border bg-bg-card p-8 text-center"><p className="text-white">No scans yet</p><p className="text-sm text-gray-400 mt-1">Run a scan from the overview to establish your baseline.</p><Link href="/" className="inline-block mt-4 text-sm text-accent hover:underline">Go to overview</Link></div> : <div className="bg-bg-card border border-border rounded-lg overflow-x-auto">
      <div className="min-w-[760px] grid grid-cols-[1.4fr_1fr_110px_110px_130px] gap-3 px-4 py-3 border-b border-border text-[10px] uppercase tracking-wider text-gray-500"><span>Started</span><span>Root</span><span>Trigger</span><span>Status</span><span className="text-right">Coverage / duration</span></div>
      {scans.map((scan) => <div key={scan.id} className="min-w-[760px] grid grid-cols-[1.4fr_1fr_110px_110px_130px] gap-3 items-center px-4 py-3 border-b border-border/60 last:border-0 text-xs"><div><p className="text-gray-200">{formatDate(scan.startedAt)}</p><p className="text-[10px] text-gray-600 font-mono truncate">{scan.id}</p></div><span className="font-mono text-gray-400 truncate" title={scan.rootPath}>{scan.rootPath}</span><span className="capitalize text-gray-400">{scan.triggerType}</span><StatusBadge status={scan.status} /><div className="text-right"><p className="text-gray-300">{formatDuration(scan.startedAt, scan.completedAt)}</p><p className="text-gray-500">{formatCount(scan.scannedDirectoryCount)} measured · {formatCount(scan.inaccessibleDirectoryCount)} incomplete</p></div></div>)}
    </div>}
  </div>;
}
