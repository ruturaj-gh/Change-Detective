"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Info, CircleAlert } from "lucide-react";
import { api, type Finding } from "@/lib/api";
import { formatDate, formatBytes, formatDelta, cn } from "@/lib/utils";

function evidenceValue(key: string, value: unknown): string {
  if (key.toLowerCase().includes("bytes") && typeof value === "string" && /^-?\d+$/.test(value)) {
    return key.toLowerCase().includes("delta") ? formatDelta(value) : formatBytes(value);
  }
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value);
}

export default function FindingsPage() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    api.findings.list()
      .then((findingResult) => setFindings(findingResult.findings))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function safeNextStep(type: string): string {
    switch (type) {
      case "low_free_space": return "Review drive usage in File Explorer. Change or move files manually if you choose; this app does not delete files.";
      case "significant_growth": return "Review the listed directory and run another scan later to see whether the measured growth persists.";
      case "incomplete_scan": return "Review access permissions for the affected directories, then run another scan. Incomplete sizes are not exact.";
      case "scan_failed": return "Confirm the monitored root is available, then retry the scan.";
      default: return "Review the supporting measurements and run another scan if you need to confirm the observation.";
    }
  }

  return <div className="p-6 space-y-5 max-w-[1000px]">
    <header><p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Evidence</p><h1 className="text-2xl font-semibold">Findings</h1><p className="text-sm text-gray-400 mt-1">Warnings are generated from measured values and documented rules.</p></header>
    {loading ? <p className="text-sm text-gray-500 py-8 text-center">Loading findings…</p> : error ? <div role="alert" className="rounded border border-danger/30 bg-danger/5 p-4 text-sm text-danger">Could not load findings. Check the local API and database. {error}</div> : findings.length === 0 ? <div className="rounded-lg border border-border bg-bg-card p-8 text-center"><p className="text-white">No findings recorded</p><p className="text-sm text-gray-400 mt-1">Warnings will appear here when a scan measures a configured threshold or incomplete coverage.</p></div> : <div className="space-y-3">{findings.map((finding) => {
      const scan = finding.scan;
      const rule = finding.evidence["rule"];
      const Icon = finding.severity === "critical" ? CircleAlert : finding.severity === "warning" ? AlertTriangle : Info;
      const color = finding.severity === "critical" ? "text-danger" : finding.severity === "warning" ? "text-warning" : "text-blue-400";
      return <article key={finding.id} className="bg-bg-card border border-border rounded-lg p-4">
        <div className="flex items-start gap-3"><Icon size={17} className={cn("mt-0.5 shrink-0", color)} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold text-white">{finding.title}</h2><span className={cn("text-[10px] uppercase tracking-wider", color)}>{finding.severity}</span><span className="text-[10px] text-gray-500">{formatDate(scan?.startedAt ?? finding.createdAt)}</span></div><p className="text-xs text-gray-300 mt-2 leading-relaxed">{finding.description}</p>
          <p className="mt-2 text-[11px] text-gray-500">Root: <span className="font-mono text-gray-300">{scan?.rootPath ?? "Not available in recent scan history"}</span></p>
          {typeof rule === "string" && <p className="mt-1 text-[11px] text-gray-500">Rule: <span className="font-mono text-gray-300">{rule}</span></p>}
          {Object.keys(finding.evidence).length > 0 && <details className="mt-3"><summary className="cursor-pointer text-[11px] text-accent">View rule evidence</summary><dl className="grid sm:grid-cols-2 gap-x-5 gap-y-2 mt-3">{Object.entries(finding.evidence).map(([key, value]) => <div key={key} className="min-w-0"><dt className="text-[10px] text-gray-500">{key}</dt><dd className="text-xs text-gray-200 font-mono break-all">{evidenceValue(key, value)}</dd></div>)}</dl></details>}
          {finding.scanId && <p className="mt-3 text-[11px] text-gray-500">Scan reference: <span className="font-mono text-gray-300">{finding.scanId}</span></p>}
          <div className="mt-3 rounded border border-border bg-bg-page/60 p-3"><p className="text-[10px] uppercase tracking-wider text-gray-500">Safe next step</p><p className="text-xs text-gray-300 mt-1">{safeNextStep(finding.findingType)}</p></div>
          <p className="text-[10px] text-gray-500 mt-3">This finding describes observed measurements; it does not identify what caused the change.</p>
        </div></div>
      </article>;
    })}</div>}
  </div>;
}
