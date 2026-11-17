"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const fieldClass =
  "mt-1 w-full rounded border border-border bg-bg-page px-3 py-2 text-sm text-white outline-none focus:border-accent";

const signInErrors: Record<string, string> = {
  google_not_configured:
    "Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the API.",
  privacy_required: "Read and accept the privacy notice to continue.",
  google_auth_failed:
    "Google sign-in could not be completed. Please try again.",
};

export default function LoginPage() {
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const url = new URL(window.location.href);
    const signInError = url.searchParams.get("error");
    if (signInError) {
      setError(
        signInErrors[signInError] ??
          "Google sign-in could not be completed. Please try again."
      );
      url.searchParams.delete("error");
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  function signIn() {
    if (!acceptPrivacy) {
      setError("Read and accept the privacy notice to continue.");
      return;
    }
    window.location.assign("/api/auth/google?acceptPrivacy=true");
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <section className="w-full max-w-sm space-y-5 rounded-lg border border-border bg-bg-card p-6">
        <header>
          <p className="text-[10px] uppercase tracking-widest text-accent">
            Change Detective
          </p>
          <h1 className="mt-2 text-xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-gray-400">
            Continue with Google to view your private storage history. New
            accounts are created on your first sign-in.
          </p>
        </header>

        {error && (
          <p
            role="alert"
            className="rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
          >
            {error}
          </p>
        )}

        <label className="flex items-start gap-2 text-xs leading-relaxed text-gray-400">
          <input
            type="checkbox"
            checked={acceptPrivacy}
            onChange={(event) => {
              setAcceptPrivacy(event.target.checked);
              setError("");
            }}
            className="mt-0.5 accent-accent"
          />
          <span>
            I have read the{" "}
            <Link
              href="/privacy"
              className="text-accent underline"
              target="_blank"
            >
              privacy notice
            </Link>{" "}
            and understand what device and scan data this service stores.
          </span>
        </label>

        <button
          type="button"
          onClick={signIn}
          className="w-full rounded bg-accent px-4 py-2 text-sm font-semibold text-black hover:bg-accent/80"
        >
          Continue with Google
        </button>
      </section>
    </div>
  );
}
