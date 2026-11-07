"use client";

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { formatBytes } from "@/lib/utils";

interface DataPoint {
  date: string;
  usedBytes: number;
  freeBytes: number;
}

export function StorageHistoryChart({ data }: { data: DataPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-xs text-gray-500">
        No historical data yet — run at least one scan.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="usedGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="freeGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#4b5563" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#4b5563" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} />
        <YAxis
          tickFormatter={(v: number) => formatBytes(v)}
          tick={{ fontSize: 10, fill: "#6b7280" }}
          axisLine={false}
          tickLine={false}
          width={55}
        />
        <Tooltip
          contentStyle={{ background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 6, fontSize: 11 }}
          labelStyle={{ color: "#9ca3af" }}
          formatter={(value: number, name: string) => [formatBytes(value), name === "usedBytes" ? "Used" : "Free"]}
        />
        <Legend
          formatter={(v: string) => (
            <span style={{ fontSize: 10, color: "#9ca3af" }}>{v === "usedBytes" ? "Used" : "Free"}</span>
          )}
        />
        <Area type="monotone" dataKey="usedBytes" stroke="#22c55e" strokeWidth={2} fill="url(#usedGrad)" dot={false} />
        <Area type="monotone" dataKey="freeBytes" stroke="#374151" strokeWidth={1.5} fill="url(#freeGrad)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

