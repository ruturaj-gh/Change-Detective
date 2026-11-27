"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, type Device, type Settings } from "@/lib/api";

const fieldClass = "mt-1 w-full rounded border border-border bg-bg-page px-3 py-2 text-sm text-white outline-none focus:border-accent";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [agents, setAgents] = useState<Device[]>([]);
  const [agentRoots, setAgentRoots] = useState<Record<string, string>>({});
  const [savingDeviceId, setSavingDeviceId] = useState("");
  const [root, setRoot] = useState("");
  const [interval, setInterval] = useState("360");
  const [threshold, setThreshold] = useState("10");
  const [retention, setRetention] = useState("90");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);

  useEffect(() => { api.settings.get().then(({ settings: value }) => { setSettings(value); setRoot(value.monitoredRoot); setInterval(String(value.scanIntervalMinutes)); setThreshold(String(value.lowSpaceThresholdPercent)); setRetention(String(value.historyRetentionDays)); }).catch((e: Error) => setError(e.message)).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    let active = true;
    const refreshAgents = () => api.devices().then(({ devices }) => {
      if (active) {
        setAgents(devices);
      }
    }).catch((e: Error) => {
      if (active) setError(e.message);
    });
    void refreshAgents();
    const timer = globalThis.setInterval(() => void refreshAgents(), 30_000);
    return () => { active = false; globalThis.clearInterval(timer); };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage(""); setError("");
    try {
      const normalizedRoot = root.trim();
      if (settings && normalizedRoot !== settings.monitoredRoot) {
        const approved = window.confirm(`Change the monitored root to ${normalizedRoot}? Future scans will form a separate comparison history. Existing scan history will be kept.`);
        if (!approved) return;
      }
      const result = await api.settings.update({ monitoredRoot: normalizedRoot, scanIntervalMinutes: Number(interval), lowSpaceThresholdPercent: Number(threshold), historyRetentionDays: Number(retention) });
      setSettings(result.settings); setMessage("Settings saved. The default root affects local scans only; existing sensor roots are managed per device below.");
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  async function revokeAgent(device: Device) {
    if (!window.confirm(`Revoke the agent "${device.name}"? It will no longer be able to connect. Existing scan history will be kept.`)) return;
    setAgentBusy(true); setError("");
    try {
      await api.agents.revoke(device.id);
      setAgents((current) => current.filter((agent) => agent.id !== device.id));
      setMessage("Agent access revoked. Existing scan history was kept.");
    } catch (e) { setError((e as Error).message); }
    finally { setAgentBusy(false); }
  }

  async function saveAgentRoot(device: Device) {
    const monitoredRoot = (agentRoots[device.id] ?? device.monitoredRoot ?? "").trim();
    setSavingDeviceId(device.id);
    setError("");
    try {
      await api.updateDeviceRoot(device.id, monitoredRoot);
      setAgents((current) =>
        current.map((item) =>
          item.id === device.id ? { ...item, monitoredRoot } : item
        )
      );
      setMessage(`Monitored root updated for ${device.name}. Update monitoredRoot in the agent's local agent.json configuration and restart the agent.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update device path.");
    } finally {
      setSavingDeviceId("");
    }
  }

  if (loading) return <div className="p-4 text-sm text-gray-500 sm:p-6">Loading settings…</div>;
  return <div className="max-w-[760px] space-y-5 p-4 sm:p-6">
    <header><p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Configuration</p><h1 className="text-2xl font-semibold">Settings</h1><p className="text-sm text-gray-400 mt-1">Configure scanning and warning thresholds.</p></header>
    {error && <p role="alert" className="rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}
    {message && <p role="status" className="rounded border border-accent/30 bg-accent/5 p-3 text-sm text-accent">{message}</p>}
    <form onSubmit={save} className="bg-bg-card border border-border rounded-lg p-5 space-y-5">
      <div><label htmlFor="root" className="text-xs font-medium text-gray-200">Default monitored root</label><input id="root" required value={root} onChange={(e) => setRoot(e.target.value)} className={fieldClass} placeholder="/home/username or C:\Users\username" /><p className="text-[11px] text-gray-500 mt-1">Used by local scans. Each remote sensor has its own approved root below.</p></div>
      <div className="grid sm:grid-cols-3 gap-4">
        <div><label htmlFor="interval" className="text-xs font-medium text-gray-200">Scan interval (minutes)</label><input id="interval" type="number" min={15} max={10080} step={1} required value={interval} onChange={(e) => setInterval(e.target.value)} className={fieldClass} /><p className="text-[11px] text-gray-500 mt-1">15 to 10,080 minutes</p></div>
        <div><label htmlFor="threshold" className="text-xs font-medium text-gray-200">Low space warning (%)</label><input id="threshold" type="number" min={0} max={100} step="any" required value={threshold} onChange={(e) => setThreshold(e.target.value)} className={fieldClass} /><p className="text-[11px] text-gray-500 mt-1">0 to 100 percent free</p></div>
        <div><label htmlFor="retention" className="text-xs font-medium text-gray-200">History retention (days)</label><input id="retention" type="number" min={1} max={3650} step={1} required value={retention} onChange={(e) => setRetention(e.target.value)} className={fieldClass} /><p className="text-[11px] text-gray-500 mt-1">1 to 3,650 days</p></div>
      </div>
      <div className="rounded border border-border bg-bg-page/60 p-3 text-xs text-gray-400"><p className="text-gray-200 font-medium">Scanning and data</p>      <p className="mt-1">The API validates remote scan results against each device's approved path. Scheduled scans are queued while the API is active. Scan and finding history older than the account's retention period is automatically deleted during periodic cleanup.</p></div>
      <div className="flex items-center justify-between"><span className="text-[10px] text-gray-600">{settings ? `Last updated ${new Date(settings.updatedAt).toLocaleString()}` : ""}</span><button disabled={saving} className="rounded bg-accent px-4 py-2 text-sm font-semibold text-black hover:bg-accent/80 disabled:opacity-50">{saving ? "Saving…" : "Save settings"}</button></div>
    </form>

    <section className="bg-bg-card border border-border rounded-lg p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Your scanning devices</h2>
        <p className="mt-1 text-xs text-gray-400">The sensor scans only its locally approved directory and connects outbound to this service over HTTPS. Windows and Linux bundles are available; macOS and native Android support are planned. Use one sensor per device; each has its own OS, path, connection status, and scan history.</p>
      </div>
      {agents.map((agent) => (
        <div key={agent.id} className="rounded border border-border bg-bg-page/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm text-gray-200">{agent.name} · {agent.osName}</p>
              <p className="mt-1 text-[11px] text-gray-500">{agent.isAgent ? "Remote scanning agent" : "Local scanner on the server host"}</p>
              <p className="mt-1 truncate font-mono text-[11px] text-gray-400">{agent.monitoredRoot || "No path configured"}</p>
              <p className="mt-1 text-[11px] text-gray-500">
                {agent.isAgent
                  ? agent.lastSeenAt ? `Last connected ${new Date(agent.lastSeenAt).toLocaleString()}` : "Not connected yet"
                  : `Added ${new Date(agent.createdAt).toLocaleString()}`}
              </p>
            </div>
            {agent.isAgent && <button type="button" disabled={agentBusy} onClick={() => void revokeAgent(agent)} className="shrink-0 rounded border border-danger/40 px-3 py-2 text-xs text-danger hover:bg-danger/10 disabled:opacity-50">Revoke access</button>}
          </div>
          {agent.isAgent && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                aria-label={`Monitored root for ${agent.name}`}
                value={agentRoots[agent.id] ?? agent.monitoredRoot ?? ""}
                onChange={(event) => setAgentRoots((current) => ({ ...current, [agent.id]: event.target.value }))}
                className="min-w-0 flex-1 rounded border border-border bg-bg-card px-3 py-2 font-mono text-xs text-white"
                placeholder={agent.osName === "Windows" ? "C:\\Users\\username" : "/home/username"}
              />
              <button type="button" disabled={savingDeviceId === agent.id || !((agentRoots[agent.id] ?? agent.monitoredRoot ?? "").trim())} onClick={() => void saveAgentRoot(agent)} className="rounded border border-border px-3 py-2 text-xs text-gray-200 hover:bg-white/5 disabled:opacity-50">{savingDeviceId === agent.id ? "Saving…" : "Save device path"}</button>
            </div>
          )}
        </div>
      ))}
      <div className="rounded border border-border bg-bg-page/60 p-3">
        <h3 className="text-xs font-medium text-gray-200">Add a Windows or Linux sensor</h3>
        <p className="mt-1 text-xs text-gray-400">Download and run the sensor on the computer you want to scan. It opens a browser pairing page; sign in and approve the device there. No setup token or Node.js installation is needed.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href="https://github.com/ruturaj-gh/Change-Detective/releases/latest/download/change-detective-agent-win32-x64.zip" className="rounded border border-border px-3 py-2 text-xs text-gray-200 hover:bg-white/5">Download for Windows</a>
          <a href="https://github.com/ruturaj-gh/Change-Detective/releases/latest/download/change-detective-agent-linux-x64.tar.gz" className="rounded border border-border px-3 py-2 text-xs text-gray-200 hover:bg-white/5">Download for Linux</a>
          <a href="https://github.com/ruturaj-gh/Change-Detective/releases" className="self-center text-xs text-accent hover:underline">All releases</a>
        </div>
        <p className="mt-2 text-[11px] text-gray-500">Downloads become available after the first tagged sensor release is published. The sensor asks for this dashboard URL and folder, then shows device name, operating system, and folder in the browser for approval. You can revoke access here at any time.</p>
      </div>
    </section>
  </div>;
}
