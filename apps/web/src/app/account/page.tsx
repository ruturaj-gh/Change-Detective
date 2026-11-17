"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Account } from "@/lib/api";

export default function AccountPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.account.get()
      .then(({ account: result }) => setAccount(result))
      .catch((cause: Error) => setError(cause.message));
  }, []);

  async function deleteAccount() {
    setError("");
    if (confirmation !== "DELETE") {
      setError("Type DELETE to confirm account and scan-data removal.");
      return;
    }
    if (!window.confirm("Permanently delete your account, devices, scans, findings, and settings? This cannot be undone.")) return;
    setBusy(true);
    try {
      await api.account.delete("DELETE");
      window.location.replace("/login");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the account.");
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[760px] space-y-5 p-4 sm:p-6">
      <header>
        <p className="mb-1 text-[10px] uppercase tracking-widest text-gray-500">Account and privacy</p>
        <h1 className="text-2xl font-semibold text-white">Your account</h1>
      </header>
      {error && <p role="alert" className="rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}
      <section className="space-y-3 rounded-lg border border-border bg-bg-card p-5">
        <h2 className="text-sm font-semibold text-white">Account details</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-gray-500">Email</dt><dd className="mt-1 break-all text-gray-200">{account?.email ?? "Loading…"}</dd></div>
          <div><dt className="text-xs text-gray-500">Google email status</dt><dd className="mt-1 text-gray-200">{account?.emailVerifiedAt ? "Verified" : "Unverified legacy account"}</dd></div>
          <div><dt className="text-xs text-gray-500">Privacy notice accepted</dt><dd className="mt-1 text-gray-200">{account?.privacyNoticeVersion ? `${account.privacyNoticeVersion} · ${account.privacyAcceptedAt ? new Date(account.privacyAcceptedAt).toLocaleDateString() : ""}` : "Not recorded for this legacy account"}</dd></div>
          <div><dt className="text-xs text-gray-500">Your devices</dt><dd className="mt-1 text-gray-200">{account?.deviceCount ?? "—"}</dd></div>
          <div><dt className="text-xs text-gray-500">Stored scan records</dt><dd className="mt-1 text-gray-200">{account?.scanCount ?? "—"}</dd></div>
        </dl>
        <Link href="/settings" className="inline-block text-xs text-accent hover:underline">Manage scanning devices and retention settings</Link>
        <Link href="/privacy" className="ml-4 inline-block text-xs text-accent hover:underline">Read privacy notice</Link>
      </section>
      <section className="space-y-3 rounded-lg border border-border bg-bg-card p-5">
        <h2 className="text-sm font-semibold text-white">Data we store</h2>
        <ul className="list-disc space-y-2 pl-5 text-xs leading-relaxed text-gray-400">
          <li>Your Google account email address and account creation time. The app stores a Google account identifier to recognize your account; it does not store your Google password.</li>
          <li>Device name and OS, the monitored path you approve, and the time the agent last connected. We do not use MAC addresses.</li>
          <li>Directory paths and aggregate directory sizes/counts, disk capacity metrics, scan timestamps/status, and findings. File contents and hashes are not collected.</li>
          <li>The app does not intentionally save your IP address in its database. Hosting providers, reverse proxies, or operational logs may process IP addresses; disclose their retention separately.</li>
        </ul>
        <p className="text-xs text-gray-400">Scan and finding history follows the retention period configured in Settings. Deleting your account permanently removes its devices and associated data.</p>
      </section>
      <section className="space-y-3 rounded-lg border border-danger/30 bg-danger/5 p-5">
        <h2 className="text-sm font-semibold text-danger">Delete account and data</h2>
        <p className="text-xs leading-relaxed text-gray-400">This revokes all connected agents and deletes your account, device records, scans, directory measurements, findings, and settings.</p>
        <label htmlFor="delete-confirmation" className="block text-xs text-gray-300">Type DELETE to confirm</label>
        <input id="delete-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="w-full rounded border border-border bg-bg-page px-3 py-2 text-sm text-white sm:max-w-sm" />
        <button type="button" disabled={busy || confirmation !== "DELETE"} onClick={() => void deleteAccount()} className="rounded bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Deleting…" : "Permanently delete my account"}</button>
      </section>
    </div>
  );
}
