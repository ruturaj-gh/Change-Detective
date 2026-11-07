"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderSearch,
  History,
  AlertTriangle,
  Settings,
  Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const navItems = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/directory-changes", label: "Directory Changes", icon: FolderSearch },
  { href: "/scan-history", label: "Scan History", icon: History },
  { href: "/findings", label: "Findings", icon: AlertTriangle, badgeKey: true },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [findingsCount, setFindingsCount] = useState(0);
  const [deviceName, setDeviceName] = useState("Windows PC");

  useEffect(() => {
    api.findings.list().then((r) => {
      setFindingsCount(r.findings.filter((f) => !f.resolvedAt).length);
    }).catch(() => {});
    api.devices().then((r) => {
      if (r.devices[0]) setDeviceName(r.devices[0].name);
    }).catch(() => {});
  }, []);

  return (
    <aside className="w-[155px] shrink-0 bg-bg-sidebar border-r border-border flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 pt-5 pb-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-accent/20 border border-accent/40 flex items-center justify-center">
            <Monitor size={14} className="text-accent" />
          </div>
          <div>
            <div className="text-xs font-semibold text-white leading-tight">Change Detective</div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Storage Monitor</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {navItems.map(({ href, label, icon: Icon, badgeKey }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs transition-colors group",
                active
                  ? "bg-accent/10 text-accent"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              )}
            >
              <Icon size={14} className={cn(active ? "text-accent" : "text-gray-500 group-hover:text-gray-300")} />
              <span className="flex-1 truncate">{label}</span>
              {badgeKey && findingsCount > 0 && (
                <span className="bg-accent text-black text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {findingsCount > 9 ? "9+" : findingsCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 pb-4 border-t border-border pt-3 space-y-1">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          <span className="text-[10px] text-gray-400">Local device</span>
        </div>
        <p className="text-[9px] text-gray-600">Data stays on this computer</p>
        <Link href="/settings" className="text-[9px] text-gray-500 hover:text-accent transition-colors">
          View first-run setup
        </Link>
        <p className="text-[9px] text-gray-600 uppercase tracking-wider mt-1">{deviceName}</p>
      </div>
    </aside>
  );
}

