"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api, ApiError } from "@/lib/api";
import SiteHeader from "@/components/site-header";
import { Button, ErrorBox, Field, inputClass, SuccessBox } from "@/components/ui";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      await api("/auth/password/reset", { method: "POST", body: { token, password } });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.code === "INVALID_OR_EXPIRED_TOKEN" ? err.message : null);
        setIssues(err.issues.map((i) => `${i.path}: ${i.message}`));
        if (err.code !== "INVALID_OR_EXPIRED_TOKEN" && err.issues.length === 0) {
          setError(err.message);
        }
      } else {
        setError("Something went wrong — please try again.");
      }
    }
    setBusy(false);
  }

  if (!token) {
    return <ErrorBox title="This reset link is missing its token — request a new one." />;
  }

  if (done) {
    return (
      <div className="space-y-4">
        <SuccessBox>Your password has been changed and every device was signed out.</SuccessBox>
        <Link
          href="/login"
          className="inline-flex rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          Sign in with your new password
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error || issues.length > 0 ? <ErrorBox title={error} issues={issues} /> : null}
      <Field label="New password" htmlFor="password" hint="At least 12 characters.">
        <input
          id="password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          className={inputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm">
        <input
          id="confirm"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          className={inputClass}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Field>
      <Button busy={busy}>Set new password</Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Choose a new password
        </h1>
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <Suspense>
            <ResetForm />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
