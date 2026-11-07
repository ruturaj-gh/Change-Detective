import { cn } from "@/lib/utils";

type Status = "completed" | "partial" | "failed" | "cancelled" | "queued" | "running";

const config: Record<Status, { dot: string; text: string; label: string }> = {
  completed: { dot: "bg-accent", text: "text-accent", label: "Complete" },
  partial:   { dot: "bg-warning", text: "text-warning", label: "Incomplete" },
  failed:    { dot: "bg-danger",  text: "text-danger",  label: "Failed" },
  cancelled: { dot: "bg-gray-500", text: "text-gray-400", label: "Cancelled" },
  queued:    { dot: "bg-blue-400", text: "text-blue-400", label: "Queued" },
  running:   { dot: "bg-accent animate-pulse", text: "text-accent", label: "Scanning…" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = (status as Status) in config ? (status as Status) : "failed";
  const { dot, text, label } = config[s];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded border", text, "border-current/20 bg-current/5")}>
      <span className={cn("w-1.5 h-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}

