"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type AgentPairingRequest } from "@/lib/api";

export default function PairDevicePage() {
  const params = useParams<{ id: string }>();
  const pairingId = params.id;
  const [pairing, setPairing] = useState<AgentPairingRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.agents
      .pairing(pairingId)
      .then(({ pairing: request }) => {
        if (active) setPairing(request);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Could not load this pairing request.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [pairingId]);

  async function approve() {
    setApproving(true);
    setError("");
    try {
      await api.agents.approvePairing(pairingId);
      setPairing({ status: "completed" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not approve this device.");
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 sm:p-8">
      <section className="w-full max-w-lg space-y-5 rounded-lg border border-border bg-bg-card p-5 sm:p-7">
        <header>
          <p className="text-[10px] uppercase tracking-widest text-accent">Change Detective</p>
          <h1 className="mt-2 text-xl font-semibold">Approve scanning device</h1>
          <p className="mt-2 text-sm text-gray-400">
            Only approve this request if you started pairing on a device you control.
          </p>
        </header>

        {loading && <p className="text-sm text-gray-400">Loading pairing request…</p>}
        {error && <p role="alert" className="rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}
        {!loading && pairing?.status === "pending" && (
          <>
            <dl className="space-y-3 rounded border border-border bg-bg-page/60 p-4 text-sm">
              <div>
                <dt className="text-xs text-gray-500">Device</dt>
                <dd className="mt-1 text-gray-100">{pairing.name} · {pairing.osName}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Approved directory</dt>
                <dd className="mt-1 break-all font-mono text-xs text-gray-200">{pairing.monitoredRoot}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Request expires</dt>
                <dd className="mt-1 text-gray-300">{pairing.expiresAt ? new Date(pairing.expiresAt).toLocaleString() : "Soon"}</dd>
              </div>
            </dl>
            <p className="text-xs leading-relaxed text-gray-400">
              The sensor will measure directory metadata under this folder. It does not upload file contents.
            </p>
            <button
              type="button"
              onClick={() => void approve()}
              disabled={approving}
              className="w-full rounded bg-accent px-4 py-2.5 text-sm font-semibold text-black hover:bg-accent/80 disabled:opacity-50"
            >
              {approving ? "Approving…" : "Approve this device"}
            </button>
          </>
        )}
        {!loading && pairing?.status === "completed" && (
          <p role="status" className="rounded border border-accent/30 bg-accent/5 p-3 text-sm text-accent">
            This device is paired. You can close this page and return to the sensor.
          </p>
        )}
        {!loading && pairing?.status === "expired" && (
          <p role="alert" className="rounded border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
            This pairing request has expired. Restart the sensor to request a new one.
          </p>
        )}
      </section>
    </div>
  );
}
