"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { api } from "@/lib/api";

const PUBLIC_PATHS = new Set([
  "/login",
  "/privacy",
]);

export function AuthShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<"checking" | "authenticated" | "error">(
    "checking"
  );
  const [verifiedPath, setVerifiedPath] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (PUBLIC_PATHS.has(pathname)) {
      setStatus("checking");
      setVerifiedPath(null);
      setError("");
      document.body.style.visibility = "";
      return;
    }

    let active = true;
    let verificationId = 0;
    const verifySession = () => {
      const currentVerification = ++verificationId;
      setStatus("checking");
      setVerifiedPath(null);
      setError("");

      api.auth
        .session()
        .then((session) => {
          if (!active || currentVerification !== verificationId) return;
          if (!session.authenticated) {
            router.replace("/login");
            return;
          }
          setVerifiedPath(pathname);
          setStatus("authenticated");
          document.body.style.visibility = "";
        })
        .catch((cause: unknown) => {
          if (!active || currentVerification !== verificationId) return;
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not verify sign-in status."
          );
          setVerifiedPath(pathname);
          setStatus("error");
          document.body.style.visibility = "";
        });
    };

    const handlePageHide = () => {
      document.body.style.visibility = "hidden";
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        document.body.style.visibility = "hidden";
        verifySession();
      }
    };

    verifySession();
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      active = false;
      verificationId++;
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [pathname, router]);

  if (PUBLIC_PATHS.has(pathname)) {
    return <main className="min-h-screen flex-1">{children}</main>;
  }
  if (status === "checking" || verifiedPath !== pathname) {
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
      <main className="min-h-0 flex-1 overflow-y-auto">
        {pathname !== "/" && (
          <div className="sticky top-0 z-20 border-b border-border bg-bg-page/95 px-4 py-3 backdrop-blur sm:px-6">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-xs font-medium text-gray-400 transition-colors hover:text-accent"
            >
              <ArrowLeft size={14} />
              Back to overview
            </Link>
          </div>
        )}
        {children}
      </main>
    </>
  );
}
