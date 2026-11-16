"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { api } from "@/lib/api";

export function AuthShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<"checking" | "authenticated" | "error">(
    "checking"
  );
  const [error, setError] = useState("");

  useEffect(() => {
    if (pathname === "/login") return;

    let active = true;
    setStatus("checking");
    setError("");

    api.auth
      .session()
      .then((session) => {
        if (!active) return;
        if (!session.authenticated) {
          router.replace("/login");
          return;
        }
        setStatus("authenticated");
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not verify sign-in status."
        );
        setStatus("error");
      });

    return () => {
      active = false;
    };
  }, [pathname, router]);

  if (pathname === "/login") {
    return <main className="min-h-screen flex-1">{children}</main>;
  }
  if (status === "checking") {
    return (
      <main className="flex min-h-screen flex-1 items-center justify-center text-sm text-gray-400">
        Checking sign-in…
      </main>
    );
  }
  if (status === "error") {
    return (
      <main className="flex min-h-screen flex-1 flex-col items-center justify-center gap-3 text-sm">
        <p role="alert" className="text-danger">{error}</p>
        <button
          className="rounded border border-border px-3 py-2 text-gray-300 hover:text-white"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </main>
    );
  }

  return (
    <>
      <Sidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </>
  );
}
