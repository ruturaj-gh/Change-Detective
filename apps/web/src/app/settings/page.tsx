"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, type Device, type Settings } from "@/lib/api";

const fieldClass = "mt-1 w-full rounded border border-border bg-bg-page px-3 py-2 text-sm text-white outline-none focus:border-accent";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [agents, setAgents] = useState<Device[]>([]);
  const [root, setRoot] = useState("");
  const [interval, setInterval] = useState("360");
  const [threshold, setThreshold] = useState("10");
  const [retention, setRetention] = useState("90");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [enrollmentToken, setEnrollmentToken] = useState("");
  const [enrollmentExpiresAt, setEnrollmentExpiresAt] = useState("");
  const [apiOrigin, setApiOrigin] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);

  useEffect(() => { api.settings.get().then(({ settings: value }) => { setSettings(value); setRoot(value.monitoredRoot); setInterval(String(value.scanIntervalMinutes)); setThreshold(String(value.lowSpaceThresholdPercent)); setRetention(String(value.historyRetentionDays)); }).catch((e: Error) => setError(e.message)).finally(() => setLoading(false)); }, []);
  useEffect(() => { setApiOrigin(window.location.origin); }, []);
  useEffect(() => {
    let active = true;
    const refreshAgents = () => api.devices().then(({ devices }) => {
      if (active) {
        const enrolledAgents = devices.filter((device) => device.isAgent);
        setAgents(enrolledAgents);
        if (enrolledAgents.length > 0) setEnrollmentToken("");
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
      setSettings(result.settings); setMessage("Settings saved. If the monitored root changed, update CD_MONITORED_ROOT in the agent's local configuration too.");
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  async function createEnrollment() {
    setAgentBusy(true); setError(""); setEnrollmentToken("");
    try {
      const enrollment = await api.agents.enroll();
      setEnrollmentToken(enrollment.enrollmentToken);
      setEnrollmentExpiresAt(enrollment.expiresAt);
    } catch (e) { setError((e as Error).message); }
    finally { setAgentBusy(false); }
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

  const enrollmentCommand = `read -rsp 'One-time enrollment token: ' CD_ENROLLMENT_TOKEN; echo
export CD_ENROLLMENT_TOKEN
export CD_API_URL=${shellQuote(apiOrigin)}
export CD_MONITORED_ROOT=${shellQuote(root.trim())}
npm run agent:start --workspace @change-detective/agent
unset CD_ENROLLMENT_TOKEN`;

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading settings…</div>;
  return <div className="p-6 space-y-5 max-w-[760px]">
    <header><p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Configuration</p><h1 className="text-2xl font-semibold">Settings</h1><p className="text-sm text-gray-400 mt-1">Configure scanning and warning thresholds.</p></header>
    {error && <p role="alert" className="rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}
    {message && <p role="status" className="rounded border border-accent/30 bg-accent/5 p-3 text-sm text-accent">{message}</p>}
    <form onSubmit={save} className="bg-bg-card border border-border rounded-lg p-5 space-y-5">
      <div><label htmlFor="root" className="text-xs font-medium text-gray-200">Monitored root</label><input id="root" required value={root} onChange={(e) => setRoot(e.target.value)} className={fieldClass} placeholder="/home/username" /><p className="text-[11px] text-gray-500 mt-1">Enter an absolute path on the scanner machine. Changing the root starts a separate comparison lineage.</p></div>
      <div className="grid sm:grid-cols-3 gap-4">
        <div><label htmlFor="interval" className="text-xs font-medium text-gray-200">Scan interval (minutes)</label><input id="interval" type="number" min={15} max={10080} step={1} required value={interval} onChange={(e) => setInterval(e.target.value)} className={fieldClass} /><p className="text-[11px] text-gray-500 mt-1">15 to 10,080 minutes</p></div>
        <div><label htmlFor="threshold" className="text-xs font-medium text-gray-200">Low space warning (%)</label><input id="threshold" type="number" min={0} max={100} step="any" required value={threshold} onChange={(e) => setThreshold(e.target.value)} className={fieldClass} /><p className="text-[11px] text-gray-500 mt-1">0 to 100 percent free</p></div>
        <div><label htmlFor="retention" className="text-xs font-medium text-gray-200">History retention (days)</label><input id="retention" type="number" min={1} max={3650} step={1} required value={retention} onChange={(e) => setRetention(e.target.value)} className={fieldClass} /><p className="text-[11px] text-gray-500 mt-1">1 to 3,650 days</p></div>
      </div>
      <div className="rounded border border-border bg-bg-page/60 p-3 text-xs text-gray-400"><p className="text-gray-200 font-medium">Scanning and data</p><p className="mt-1">The API validates remote scan results against the path approved when the Linux agent is enrolled. Scheduled scans are queued while the API is active. Retention is saved as a preference; automatic cleanup is not enabled.</p></div>
      <div className="flex items-center justify-between"><span className="text-[10px] text-gray-600">{settings ? `Last updated ${new Date(settings.updatedAt).toLocaleString()}` : ""}</span><button disabled={saving} className="rounded bg-accent px-4 py-2 text-sm font-semibold text-black hover:bg-accent/80 disabled:opacity-50">{saving ? "Saving…" : "Save settings"}</button></div>
    </form>

    <section className="bg-bg-card border border-border rounded-lg p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Linux scanning agent</h2>
        <p className="mt-1 text-xs text-gray-400">The agent scans only its locally approved directory and connects outbound to this service over HTTPS.</p>
      </div>
      {agents.map((agent) => (
        <div key={agent.id} className="rounded border border-border bg-bg-page/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm text-gray-200">{agent.name} · {agent.osName}</p>
              <p className="mt-1 truncate font-mono text-[11px] text-gray-500">{agent.monitoredRoot}</p>
              <p className="mt-1 text-[11px] text-gray-500">
                {agent.lastSeenAt ? `Last connected ${new Date(agent.lastSeenAt).toLocaleString()}` : "Not connected yet"}
              </p>
            </div>
            <button type="button" disabled={agentBusy} onClick={() => void revokeAgent(agent)} className="shrink-0 rounded border border-danger/40 px-3 py-2 text-xs text-danger hover:bg-danger/10 disabled:opacity-50">
              Revoke access
            </button>
          </div>
        </div>
      ))}
      {agents.length === 0 && (
        <button type="button" disabled={agentBusy || !root.trim() || !apiOrigin} onClick={() => void createEnrollment()} className="rounded bg-accent px-4 py-2 text-sm font-semibold text-black hover:bg-accent/80 disabled:opacity-50">
          {agentBusy ? "Creating…" : enrollmentToken ? "Create another enrollment token" : "Create one-time enrollment token"}
        </button>
      )}
      {enrollmentToken && (
        <div className="space-y-3 rounded border border-accent/30 bg-accent/5 p-3">
          <p className="text-xs text-gray-200">Token expires {new Date(enrollmentExpiresAt).toLocaleString()} and can be used once. Keep it private.</p>
          <code className="block break-all rounded bg-black/40 p-2 font-mono text-xs text-accent">{enrollmentToken}</code>
          <p className="text-xs text-gray-400">On your Linux PC, from a checkout of this project, run this snippet and paste the token at the hidden prompt. It will be stored in a 0600 configuration file after enrollment.</p>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-black/40 p-3 font-mono text-[11px] text-gray-300">{enrollmentCommand}</pre>
        </div>
      )}
    </section>
  </div>;
}
