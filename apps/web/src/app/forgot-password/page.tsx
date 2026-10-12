"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import SiteHeader from "@/components/site-header";
import { Button, ErrorBox, Field, inputClass, SuccessBox } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/password/forgot", { method: "POST", body: { email } });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong — please try again.");
    }
    setBusy(false);
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Reset your password
        </h1>
        <div className="mt-6 space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          {sent ? (
            <>
              <SuccessBox>
                If an account exists for that address, we&apos;ve emailed a reset link. It expires
                shortly — check your inbox and spam folder.
              </SuccessBox>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                The link was sent to <span className="font-medium">{email}</span>.
              </p>
            </>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {error ? <ErrorBox title={error} /> : null}
              <Field label="Email" htmlFor="email">
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  className={inputClass}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Button busy={busy}>Send reset link</Button>
            </form>
          )}
        </div>
        <p className="mt-4 text-center text-sm text-zinc-600 dark:text-zinc-400">
          <Link
            href="/login"
            className="font-medium text-zinc-900 underline hover:text-zinc-700 dark:text-zinc-100"
          >
            Back to sign in
          </Link>
        </p>
      </main>
    </div>
  );
}
