import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  bar?: number | null; // 0-100
  badge?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function StatCard({ label, value, sub, bar, badge, action, className }: StatCardProps) {
  return (
    <div className={cn("bg-bg-card border border-border rounded-lg p-4 flex flex-col gap-1 min-w-0", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-gray-500">{label}</span>
        {action}
      </div>
      <div className="text-2xl font-semibold text-white tabular-nums truncate">{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
      {bar !== null && bar !== undefined && (
        <div className="mt-1">
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${Math.min(bar, 100)}%` }} />
          </div>
          <div className="flex justify-between mt-0.5">
            <span className="text-[10px] text-gray-500">{bar.toFixed(0)}% used</span>
          </div>
        </div>
      )}
      {badge}
    </div>
  );
}

