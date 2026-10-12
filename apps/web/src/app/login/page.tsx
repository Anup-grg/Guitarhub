"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api, ApiError } from "@/lib/api";
import SiteHeader from "@/components/site-header";
import { Button, ErrorBox, Field, inputClass } from "@/components/ui";

const OAUTH_ERRORS: Record<string, string> = {
  oauth_email_taken:
    "An account with that email already exists here. Sign in with your password first, then link the provider from Settings.",
  oauth_error: "Sign-in was cancelled or failed — please try again.",
  oauth_state: "Your sign-in attempt expired — please try again.",
  oauth_not_configured: "That sign-in provider is not configured yet.",
  account_banned: "This account is suspended.",
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [need2fa, setNeed2fa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    OAUTH_ERRORS[searchParams.get("error") ?? ""] ?? null,
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", {
        method: "POST",
        body: {
          email,
          password,
          ...(need2fa
            ? useRecovery
              ? { recoveryCode }
              : { totp }
            : {}),
        },
      });
      router.push("/");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "TWO_FACTOR_REQUIRED") {
        setNeed2fa(true);
        setError("Enter the 6-digit code from your authenticator app.");
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Something went wrong — please try again.");
      }
      setBusy(false);
    }
  }

  return (
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

      <Field label="Password" htmlFor="password">
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          className={inputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      {need2fa ? (
        useRecovery ? (
          <Field
            label="Recovery code"
            htmlFor="recoveryCode"
            hint="One of the 10 codes you saved when you turned on two-factor authentication."
          >
            <input
              id="recoveryCode"
              className={inputClass}
              autoComplete="one-time-code"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
            />
          </Field>
        ) : (
          <Field label="Two-factor code" htmlFor="totp" hint="Open your authenticator app.">
            <input
              id="totp"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={8}
              required
              autoComplete="one-time-code"
              className={inputClass}
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
            />
          </Field>
        )
      ) : null}

      {need2fa ? (
        <button
          type="button"
          className="text-sm font-medium text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
          onClick={() => setUseRecovery((v) => !v)}
        >
          {useRecovery ? "Use my authenticator app instead" : "Use a recovery code instead"}
        </button>
      ) : null}

      <div className="flex items-center justify-between pt-1">
        <Button busy={busy}>Sign in</Button>
        <Link
          href="/forgot-password"
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
        >
          Forgot password?
        </Link>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Sign in
        </h1>
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <Suspense>
            <LoginForm />
          </Suspense>

          <div className="mt-6 space-y-3 border-t border-zinc-200 pt-5 dark:border-zinc-800">
            <a
              href="/api/v1/auth/oauth/google"
              className="flex w-full items-center justify-center rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Continue with Google
            </a>
            <a
              href="/api/v1/auth/oauth/github"
              className="flex w-full items-center justify-center rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Continue with GitHub
            </a>
          </div>
        </div>
        <p className="mt-4 text-center text-sm text-zinc-600 dark:text-zinc-400">
          New to GuitarHub?{" "}
          <Link
            href="/register"
            className="font-medium text-zinc-900 underline hover:text-zinc-700 dark:text-zinc-100"
          >
            Create an account
          </Link>
        </p>
      </main>
    </div>
  );
}
