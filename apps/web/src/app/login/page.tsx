"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

const fieldClass =
  "mt-1 w-full rounded border border-border bg-bg-page px-3 py-2 text-sm text-white outline-none focus:border-accent";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.auth.login(email, password);
      router.replace("/");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not sign in."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-lg border border-border bg-bg-card p-6"
      >
        <header>
          <p className="text-[10px] uppercase tracking-widest text-accent">
            Change Detective
          </p>
          <h1 className="mt-2 text-xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-gray-400">
            Sign in to view your storage history.
          </p>
        </header>

        {error && (
          <p role="alert" className="rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {error}
          </p>
        )}

        <div>
          <label htmlFor="email" className="text-xs font-medium text-gray-200">
            Email
          </label>
          <input
            id="email"
            autoComplete="username"
            type="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={fieldClass}
          />
        </div>

        <div>
          <label htmlFor="password" className="text-xs font-medium text-gray-200">
            Password
          </label>
          <input
            id="password"
            autoComplete="current-password"
            type="password"
            required
            maxLength={256}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={fieldClass}
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-accent px-4 py-2 text-sm font-semibold text-black hover:bg-accent/80 disabled:opacity-50"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
