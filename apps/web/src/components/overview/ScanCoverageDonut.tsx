"use client";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { AlertCircle } from "lucide-react";
import { formatCount } from "@/lib/utils";

interface ScanCoverageDonutProps {
  scanned: number;
  incomplete: number;
}

export function ScanCoverageDonut({ scanned, incomplete }: ScanCoverageDonutProps) {
  const complete = Math.max(scanned - incomplete, 0);
  const pct = scanned > 0 ? `${Math.round((complete / scanned) * 100)}%` : "—";
  const data = [
    { value: complete },
    { value: incomplete > 0 ? incomplete : 0.01 }, // avoid empty chart
  ];

  return (
    <div className="flex items-center gap-4">
      <div className="relative w-24 h-24 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={28}
              outerRadius={40}
              startAngle={90}
              endAngle={-270}
              dataKey="value"
              strokeWidth={0}
            >
              <Cell fill="#22c55e" />
              <Cell fill="#1e2a1e" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold text-white tabular-nums">{pct}</span>
        </div>
      </div>
      <div className="space-y-1 min-w-0">
        <div>
          <span className="text-sm font-semibold text-white tabular-nums">{formatCount(complete)}</span>
          <span className="text-xs text-gray-500 ml-1">fully measured</span>
        </div>
        <div>
          <span className="text-sm font-semibold text-gray-400 tabular-nums">{formatCount(incomplete)}</span>
          <span className="text-xs text-gray-500 ml-1">incomplete</span>
        </div>
        {incomplete > 0 && (
          <div className="flex items-start gap-1.5 mt-2 text-[10px] text-gray-500 bg-white/3 rounded p-2 border border-border">
            <AlertCircle size={10} className="mt-0.5 shrink-0 text-gray-500" />
            One or more directories could not be fully measured.
          </div>
        )}
      </div>
    </div>
  );
}

