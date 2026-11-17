import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl space-y-6 p-5 text-gray-300 sm:p-8">
      <header>
        <p className="text-[10px] uppercase tracking-widest text-accent">Change Detective</p>
        <h1 className="mt-2 text-2xl font-semibold text-white">Privacy notice</h1>
        <p className="mt-1 text-xs text-gray-500">Version 2026-11-17</p>
      </header>
      <section className="space-y-2">
        <h2 className="font-semibold text-white">Information stored</h2>
        <p className="text-sm leading-relaxed">The service stores your Google account email and stable Google account identifier, privacy-notice acceptance timestamps, device name and operating system, the filesystem paths you approve, scan times and statuses, directory paths and aggregate sizes/counts, available disk-capacity measurements, and generated findings. Agent credentials are stored as hashes. The app never receives or stores your Google password.</p>
        <p className="text-sm leading-relaxed">The scanner does not read or upload file contents and does not compute file hashes. It does not use MAC addresses to identify devices. The app does not intentionally store IP addresses in account data; the API host, hosting provider, reverse proxy, email provider, or security tooling may process IP addresses in operational logs. Their log retention is determined by the operator and hosting configuration.</p>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold text-white">Purpose and visibility</h2>
        <p className="text-sm leading-relaxed">Account information is used to authenticate you, bind each device and its scans to your account, show storage changes, and protect the service from abuse. Authenticated API queries are scoped to your account. Other users cannot view your account's device and scan records through the app.</p>
        <p className="text-sm leading-relaxed">A scanner agent runs on the device you install it on and can inspect only the monitored directory you approve and the operating-system permissions granted to that process. Android requires Termux and explicit shared-storage permission; the Android browser alone does not scan the phone.</p>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold text-white">Retention and deletion</h2>
        <p className="text-sm leading-relaxed">Scan and finding records are periodically deleted according to the retention period in your account Settings while the API scheduler is running. Expired account action tokens and stale unverified accounts are also cleaned periodically. Account deletion immediately removes the account and cascades to its devices, scans, findings, and settings. Copies in database backups and infrastructure logs are not automatically erased by account deletion and follow the operator's separate backup/log retention policy.</p>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold text-white">Operator responsibilities</h2>
        <p className="text-sm leading-relaxed">For a self-hosted installation, the person operating the service controls the database, backups, hosting logs, access controls, and retention. Google processes sign-in according to its own privacy terms. Configure HTTPS, restrict API access, keep secrets private, and review applicable privacy, consumer, and data-protection requirements for the jurisdictions where the service and its users operate. This technical notice is not legal advice or a guarantee of compliance.</p>
        <p className="text-sm leading-relaxed">For questions about an installation, contact its operator. Before enabling public registration, provide users with an operator contact and any jurisdiction-specific disclosures required for that service.</p>
      </section>
      <Link href="/login" className="inline-block text-sm text-accent hover:underline">Back to sign in</Link>
    </main>
  );
}
