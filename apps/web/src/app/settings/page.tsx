"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, type Settings } from "@/lib/api";

const fieldClass = "mt-1 w-full rounded border border-border bg-bg-page px-3 py-2 text-sm text-white outline-none focus:border-accent";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [root, setRoot] = useState("");
  const [interval, setInterval] = useState("360");
  const [threshold, setThreshold] = useState("10");
  const [retention, setRetention] = useState("90");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { api.settings.get().then(({ settings: value }) => { setSettings(value); setRoot(value.monitoredRoot); setInterval(String(value.scanIntervalMinutes)); setThreshold(String(value.lowSpaceThresholdPercent)); setRetention(String(value.historyRetentionDays)); }).catch((e: Error) => setError(e.message)).finally(() => setLoading(false)); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage(""); setError("");
    try {
      const normalizedRoot = root.trim();
      if (settings && normalizedRoot !== settings.monitoredRoot) {
        const approved = window.confirm(`Change the monitored root to ${normalizedRoot}? Future scans will form a separate comparison history. Existing scan history will be kept.`);
        if (!approved) return;
      }
      const result = await api.settings.update({ monitoredRoot: normalizedRoot, scanIntervalMinutes: Number(interval), lowSpaceThresholdPercent: Number(threshold), historyRetentionDays: Number(retention) });
      setSettings(result.settings); setMessage("Settings saved.");
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading settings…</div>;
  return <div className="p-6 space-y-5 max-w-[760px]">
    <header><p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Configuration</p><h1 className="text-2xl font-semibold">Settings</h1><p className="text-sm text-gray-400 mt-1">Configure local scanning and warning thresholds.</p></header>
    {error && <p role="alert" className="rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}
    {message && <p role="status" className="rounded border border-accent/30 bg-accent/5 p-3 text-sm text-accent">{message}</p>}
    <form onSubmit={save} className="bg-bg-card border border-border rounded-lg p-5 space-y-5">
      <div><label htmlFor="root" className="text-xs font-medium text-gray-200">Monitored root</label><input id="root" required value={root} onChange={(e) => setRoot(e.target.value)} className={fieldClass} placeholder="C:\\" /><p className="text-[11px] text-gray-500 mt-1">Changing the root starts a separate comparison lineage. Use a local drive or directory.</p></div>
      <div className="grid sm:grid-cols-3 gap-4">
        <div><label htmlFor="interval" className="text-xs font-medium text-gray-200">Scan interval (minutes)</label><input id="interval" type="number" min={15} max={10080} step={1} required value={interval} onChange={(e) => setInterval(e.target.value)} className={fieldClass} /><p className="text-[11px] text-gray-500 mt-1">15 to 10,080 minutes</p></div>
        <div><label htmlFor="threshold" className="text-xs font-medium text-gray-200">Low space warning (%)</label><input id="threshold" type="number" min={0} max={100} step="any" required value={threshold} onChange={(e) => setThreshold(e.target.value)} className={fieldClass} /><p className="text-[11px] text-gray-500 mt-1">0 to 100 percent free</p></div>
        <div><label htmlFor="retention" className="text-xs font-medium text-gray-200">History retention (days)</label><input id="retention" type="number" min={1} max={3650} step={1} required value={retention} onChange={(e) => setRetention(e.target.value)} className={fieldClass} /><p className="text-[11px] text-gray-500 mt-1">1 to 3,650 days</p></div>
      </div>
      <div className="rounded border border-border bg-bg-page/60 p-3 text-xs text-gray-400"><p className="text-gray-200 font-medium">Local operation</p><p className="mt-1">Scan data stays in your local PostgreSQL database. Scheduled scans only run while the API process is active. Retention is saved as a preference; automatic cleanup is not enabled.</p></div>
      <div className="flex items-center justify-between"><span className="text-[10px] text-gray-600">{settings ? `Last updated ${new Date(settings.updatedAt).toLocaleString()}` : ""}</span><button disabled={saving} className="rounded bg-accent px-4 py-2 text-sm font-semibold text-black hover:bg-accent/80 disabled:opacity-50">{saving ? "Saving…" : "Save settings"}</button></div>
    </form>
  </div>;
}
