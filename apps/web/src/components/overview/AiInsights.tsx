"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Scan, Finding, DirectoryChange } from "@/lib/api";

interface AiInsightsProps {
  scan: Scan | null;
  findings: Finding[];
  changes: DirectoryChange[];
}

interface InsightResult {
  headline: string;
  bullets: string[];
  disclaimer: string;
}

export function AiInsights({ scan, findings, changes }: AiInsightsProps) {
  const [insight, setInsight] = useState<InsightResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function fetchInsights() {
    if (!scan) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);
    setInsight(null);

    try {
      const res = await fetch("/api/ai/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scan: {
            status: scan.status,
            startedAt: scan.startedAt,
            scannedDirectoryCount: scan.scannedDirectoryCount,
            inaccessibleDirectoryCount: scan.inaccessibleDirectoryCount,
            totalBytes: scan.totalBytes,
            freeBytes: scan.freeBytes,
          },
          findings: findings.slice(0, 10).map((f) => ({
            type: f.findingType,
            severity: f.severity,
            title: f.title,
            description: f.description,
          })),
          topChanges: changes
            .filter((c) => c.changeLabel !== "unchanged")
            .slice(0, 8)
            .map((c) => ({
              path: c.normalizedPath,
              deltaBytes: c.deltaBytes,
              percentChange: c.percentChange,
              label: c.changeLabel,
              reliable: c.comparisonReliable,
            })),
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setError(err.error ?? `Server error ${res.status}`);
        return;
      }

      const data = (await res.json()) as InsightResult;
      setInsight(data);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError("Could not reach the AI endpoint.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (scan?.status === "completed" || scan?.status === "partial") {
      void fetchInsights();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan?.id]);

  if (!scan || (scan.status !== "completed" && scan.status !== "partial")) return null;

  return (
    <div className="bg-bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-accent" />
          <span className="text-xs font-semibold text-white uppercase tracking-wider">AI Analysis</span>
          <span className="text-[9px] text-gray-500 border border-border rounded px-1.5 py-0.5">
            Local · Ollama
          </span>
        </div>
        <button
          onClick={() => void fetchInsights()}
          disabled={loading}
          className="text-gray-500 hover:text-white transition-colors disabled:opacity-40"
          title="Refresh AI analysis"
        >
          <RefreshCw size={12} className={cn(loading && "animate-spin")} />
        </button>
      </div>

      {loading && (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 bg-white/5 rounded w-3/4" />
          <div className="h-3 bg-white/5 rounded w-full" />
          <div className="h-3 bg-white/5 rounded w-2/3" />
        </div>
      )}

      {error && (
        <div className="text-xs text-gray-400 border border-border rounded p-3">
          <p className="font-medium text-gray-300 mb-1">AI insights unavailable</p>
          <p className="text-gray-500">{error}</p>
          <p className="text-gray-600 mt-2 text-[10px]">
            Make sure Ollama is running: <code className="font-mono">ollama serve</code>
          </p>
        </div>
      )}

      {insight && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-white">{insight.headline}</p>
          <ul className="space-y-1.5">
            {insight.bullets.map((b, i) => (
              <li key={i} className="flex gap-2 text-xs text-gray-300">
                <span className="text-accent mt-0.5">›</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-gray-600 border-t border-border pt-2">{insight.disclaimer}</p>
        </div>
      )}
    </div>
  );
}

