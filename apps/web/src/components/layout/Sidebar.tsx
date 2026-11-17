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
  LogOut,
  BookOpen,
  CircleUserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const navItems = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/directory-changes", label: "Directory Changes", icon: FolderSearch },
  { href: "/scan-history", label: "Scan History", icon: History },
  { href: "/findings", label: "Findings", icon: AlertTriangle, badgeKey: true },
  { href: "/guide", label: "Guide", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/account", label: "Account", icon: CircleUserRound },
];

export function Sidebar() {
  const pathname = usePathname();
  const [findingsCount, setFindingsCount] = useState(0);
  const [deviceName, setDeviceName] = useState("Scanning device");
  const [deviceType, setDeviceType] = useState("Local device");
  const [accountEmail, setAccountEmail] = useState("");
  const [logoutError, setLogoutError] = useState("");

  async function signOut() {
    setLogoutError("");
    try {
      await api.auth.logout();
      window.location.replace("/login");
    } catch (error) {
      setLogoutError(
        error instanceof Error ? error.message : "Could not sign out."
      );
    }
  }

  useEffect(() => {
    api.auth.session().then((session) => {
      if (session.user) setAccountEmail(session.user.email);
    }).catch(() => {});
    api.findings.list().then((r) => {
      setFindingsCount(r.findings.filter((f) => !f.resolvedAt).length);
    }).catch(() => {});
    api.devices().then((r) => {
      if (r.devices[0]) {
        setDeviceName(r.devices[0].name);
        setDeviceType(r.devices[0].isAgent ? "Scanning agent" : "Local device");
      }
    }).catch(() => {});
  }, []);

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-border bg-bg-sidebar md:h-full md:w-[155px] md:border-b-0 md:border-r">
      {/* Logo */}
      <div className="border-b border-border px-4 py-3 md:pb-4 md:pt-5">
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
      <nav className="grid grid-cols-3 gap-1 px-2 py-2 md:flex md:flex-1 md:flex-col md:gap-0.5 md:py-3">
        {navItems.map(({ href, label, icon: Icon, badgeKey }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              title={label}
              className={cn(
                "group flex min-w-0 items-center gap-1.5 rounded-md px-2 py-2 text-[10px] leading-tight transition-colors sm:text-xs md:gap-2.5 md:px-2.5",
                active
                  ? "bg-accent/10 text-accent"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              )}
            >
              <Icon size={14} className={cn(active ? "text-accent" : "text-gray-500 group-hover:text-gray-300")} />
              <span className="min-w-0 flex-1 md:truncate">{label}</span>
              {badgeKey && findingsCount > 0 && (
                <span className="hidden h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-black sm:flex">
                  {findingsCount > 9 ? "9+" : findingsCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2 md:block md:space-y-1 md:pb-4 md:pt-3">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          <span className="text-[10px] text-gray-400">{deviceType}</span>
        </div>
        <div className="hidden md:block">
          <p className="truncate text-[9px] text-gray-400" title={accountEmail}>{accountEmail}</p>
          <p className="text-[9px] text-gray-600">Data stored in dashboard database</p>
          <Link href="/settings" className="text-[9px] text-gray-500 hover:text-accent transition-colors">
            View first-run setup
          </Link>
          <p className="mt-1 text-[9px] uppercase tracking-wider text-gray-600">{deviceName}</p>
        </div>
        {logoutError && <p role="alert" className="text-[9px] text-danger">{logoutError}</p>}
        <button
          onClick={signOut}
          className="flex shrink-0 items-center gap-1.5 text-[10px] text-gray-500 hover:text-white md:mt-2"
        >
          <LogOut size={11} />
          Sign out
        </button>
      </div>
    </aside>
  );
}

