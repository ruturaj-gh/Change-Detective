import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  Clock3,
  Settings,
} from "lucide-react";

const portalPages = [
  {
    href: "/",
    title: "Overview",
    description: "Current scan status, disk capacity, storage history, largest directories, and recent findings.",
    icon: BarChart3,
  },
  {
    href: "/directory-changes",
    title: "Directory Changes",
    description: "Compare two completed scans of the same root and filter or sort measured changes.",
    icon: ArrowRight,
  },
  {
    href: "/scan-history",
    title: "Scan History",
    description: "Review previous scans, their status, coverage, trigger, and duration.",
    icon: Clock3,
  },
  {
    href: "/findings",
    title: "Findings",
    description: "Review evidence-based warnings and the rule that produced each one.",
    icon: AlertTriangle,
  },
  {
    href: "/settings",
    title: "Settings",
    description: "Choose the monitored root and configure scan interval and warning threshold.",
    icon: Settings,
  },
];

const workflow = [
  {
    title: "Choose what to monitor",
    body: "Open Settings and choose an absolute directory path on the scanning computer. In local mode, the API scans that machine. In hosted agent mode, the server and agent must agree on the root approved during enrollment.",
  },
  {
    title: "Run the first scan",
    body: "Go to Overview and select Scan now. A scan runs asynchronously; its status appears on the dashboard and in Scan History. A completed or partial scan can establish your first baseline.",
  },
  {
    title: "Review the overview",
    body: "Use the capacity and free-space values, storage history, scan coverage, largest directories, and recent findings to understand what was measured. A first scan has no earlier scan to compare against yet.",
  },
  {
    title: "Compare a later scan",
    body: "After another completed or partial scan of the same root, open Directory Changes. Select the current scan and an earlier baseline, then search, filter, or sort the measured directory differences.",
  },
  {
    title: "Investigate findings",
    body: "Open Findings to see the triggering rule and measured evidence. Use the suggested safe next step to decide what to inspect on your computer; the app reports observations, not the cause of a change.",
  },
];

export default function GuidePage() {
  return (
    <div className="max-w-[1100px] space-y-8 p-4 sm:p-6">
      <header>
        <p className="mb-1 text-[10px] uppercase tracking-widest text-gray-500">Help and workflow</p>
        <h1 className="text-2xl font-semibold text-white">Change Detective guide</h1>
        <p className="mt-1 text-sm text-gray-400">
          Follow the workflow from choosing a scan root to understanding storage changes.
        </p>
      </header>

      <section className="rounded-lg border border-accent/30 bg-accent/5 p-5">
        <div className="flex items-start gap-3">
          <BookOpen size={18} className="mt-0.5 shrink-0 text-accent" />
          <div>
            <h2 className="text-sm font-semibold text-white">The short version</h2>
            <p className="mt-1 text-sm leading-relaxed text-gray-300">
              Configure a monitored root, run an initial scan to establish a baseline, then run scans over time.
              Compare scans of the same root and use findings to identify measurements worth investigating.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/" className="rounded bg-accent px-3 py-2 text-xs font-semibold text-black hover:bg-accent/80">
                Go to overview
              </Link>
              <Link href="/settings" className="rounded border border-border px-3 py-2 text-xs text-gray-200 hover:border-accent/50 hover:text-white">
                Configure settings
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-white">Recommended workflow</h2>
        <ol className="space-y-3">
          {workflow.map((step, index) => (
            <li key={step.title} className="flex gap-4 rounded-lg border border-border bg-bg-card p-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-accent/10 text-xs font-semibold text-accent">
                {index + 1}
              </span>
              <div>
                <h3 className="text-sm font-medium text-white">{step.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-gray-400">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-white">Navigate the portal</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {portalPages.map(({ href, title, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group rounded-lg border border-border bg-bg-card p-4 transition-colors hover:border-accent/40"
            >
              <div className="flex items-center gap-2">
                <Icon size={15} className="text-accent" />
                <h3 className="text-sm font-medium text-white">{title}</h3>
                <ArrowRight size={13} className="ml-auto text-gray-600 transition-colors group-hover:text-accent" />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-gray-400">{description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-lg border border-border bg-bg-card p-5">
          <h2 className="text-sm font-semibold text-white">How to read results</h2>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-gray-400">
            <li><span className="text-gray-200">Baseline:</span> the first comparable scan has no earlier snapshot; run another scan before expecting a change comparison.</li>
            <li><span className="text-gray-200">Incomplete:</span> inaccessible or partially measured directories are marked uncertain. Their values should not be treated as exact.</li>
            <li><span className="text-gray-200">Findings:</span> alerts come from explicit rules, including low free space, incomplete or failed scans, and reliable directory growth of at least 500 MiB.</li>
            <li><span className="text-gray-200">Cause:</span> a size change alone does not show which files caused it or whether anything was deleted.</li>
          </ul>
        </article>

        <article className="rounded-lg border border-border bg-bg-card p-5">
          <h2 className="text-sm font-semibold text-white">Scheduled scans and cross-platform agents</h2>
          <p className="mt-2 text-xs leading-relaxed text-gray-400">
            Scheduled scans use the interval in Settings and run only while the API service is active. Install Node.js
            and run the agent on the device whose storage you want to monitor; Windows, macOS, and Linux are supported
            by the agent. Android is best-effort through Termux, not a native Android app: install Node.js in Termux,
            run <code>termux-setup-storage</code>, and select an accessible path such as <code>~/storage/shared</code>.
            Other Node.js platforms may work when their filesystem APIs and permissions are supported, but are not
            guaranteed. Scans are limited to the approved root and permissions of the account running the agent.
            The dashboard layout adapts to mobile browsers, but accessing a local development server from another
            device requires network and server configuration.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-gray-400">
            Enrollment and revocation are managed in Settings. Hosted operation requires HTTPS and production
            authentication; do not expose the service publicly until its deployment and database have been validated.
          </p>
        </article>
      </section>

      <section className="rounded-lg border border-border bg-bg-card p-5">
        <h2 className="text-sm font-semibold text-white">Privacy and limitations</h2>
        <p className="mt-2 text-xs leading-relaxed text-gray-400">
          Change Detective associates each account with its own devices, scans, findings, and settings. It records
          directory-level measurements and available disk capacity metrics, not file contents or file hashes. Scan
          results are snapshots, not a live view; a missing directory or incomplete scan does not by itself prove that
          data was removed. History is automatically deleted after the account's configured retention period.
        </p>
      </section>
    </div>
  );
}
