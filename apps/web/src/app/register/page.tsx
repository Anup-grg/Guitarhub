"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import SiteHeader from "@/components/site-header";
import { Button, ErrorBox, Field, inputClass } from "@/components/ui";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptGuidelines, setAcceptGuidelines] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!acceptTerms || !acceptGuidelines) {
      setError("Please accept the Terms of Service and Community Guidelines to continue.");
      return;
    }
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      await api("/auth/register", {
        method: "POST",
        body: {
          email,
          password,
          displayName,
          tosVersion: "1.0",
          acceptTerms,
          acceptGuidelines,
          rememberMe,
        },
      });
      router.push("/verify-email");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.code === "EMAIL_TAKEN" ? err.message : null);
        setIssues(
          err.code === "EMAIL_TAKEN" ? [] : err.issues.map((i) => `${i.path}: ${i.message}`),
        );
        if (err.code !== "EMAIL_TAKEN" && err.issues.length === 0) setError(err.message);
      } else {
        setError("Something went wrong — please try again.");
      }
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Create your account
        </h1>
        <form
          onSubmit={submit}
          className="mt-6 space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
        >
          {error || issues.length > 0 ? <ErrorBox title={error} issues={issues} /> : null}

          <Field label="Display name" htmlFor="displayName">
            <input
              id="displayName"
              required
              minLength={2}
              maxLength={50}
              autoComplete="nickname"
              className={inputClass}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>

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

          <Field
            label="Password"
            htmlFor="password"
            hint="At least 10 characters — a passphrase you can remember works well."
          >
            <input
              id="password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={acceptTerms}
              onChange={(e) => setAcceptTerms(e.target.checked)}
            />
            <span>
              I accept the{" "}
              <Link href="/legal/terms" className="underline hover:text-zinc-900 dark:hover:text-white">
                Terms of Service
              </Link>
            </span>
          </label>

          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={acceptGuidelines}
              onChange={(e) => setAcceptGuidelines(e.target.checked)}
            />
            <span>
              I accept the{" "}
              <Link
                href="/legal/community-guidelines"
                className="underline hover:text-zinc-900 dark:hover:text-white"
              >
                Community Guidelines
              </Link>
            </span>
          </label>

          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            <span>Keep me signed in on this device</span>
          </label>

          <Button busy={busy}>Create account</Button>
        </form>
        <p className="mt-4 text-center text-sm text-zinc-600 dark:text-zinc-400">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-zinc-900 underline hover:text-zinc-700 dark:text-zinc-100"
          >
            Sign in
          </Link>
        </p>
      </main>
    </div>
  );
}
