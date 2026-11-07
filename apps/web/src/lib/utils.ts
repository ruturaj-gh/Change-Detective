import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format bytes to human-readable string (KB / MB / GB / TB). */
export function formatBytes(bytes: string | number | bigint): string {
  const n = typeof bytes === "bigint" ? Number(bytes) : Number(bytes);
  if (isNaN(n) || n < 0) return "—";
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  const clamped = Math.min(i, units.length - 1);
  const val = n / Math.pow(1024, clamped);
  return `${val.toFixed(clamped === 0 ? 0 : 1)} ${units[clamped]}`;
}

/** Format a delta bytes string with a + or - prefix and human size. */
export function formatDelta(deltaBytes: string): string {
  const n = BigInt(deltaBytes);
  const sign = n >= 0n ? "+" : "";
  return `${sign}${formatBytes(n < 0n ? (-n).toString() : n.toString())}`;
}

/** Format percent change. */
export function formatPercent(pct: number | null): string {
  if (pct === null) return "new";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/** Get greeting by hour. */
export function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** Format ISO date to friendly string. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  if (isToday) {
    return `Today at ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Format scan duration from two ISO strings. */
export function formatDuration(start: string, end: string | null): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${rem}s`;
}

/** Format number with commas. */
export function formatCount(n: number): string {
  return n.toLocaleString();
}

/** Compute used-bytes percentage. */
export function usedPercent(totalBytes: string | null, freeBytes: string | null): number | null {
  if (!totalBytes || !freeBytes) return null;
  const total = BigInt(totalBytes);
  const free = BigInt(freeBytes);
  if (total === 0n) return null;
  return Number(((total - free) * 100n) / total);
}

