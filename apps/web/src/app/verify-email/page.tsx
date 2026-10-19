"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { api, ApiError, getCurrentUser } from "@/lib/api";
import SiteHeader from "@/components/site-header";
import { Button, ErrorBox, SuccessBox } from "@/components/ui";

type State =
  | { status: "idle" }
  | { status: "working" }
  | { status: "ok" }
  | { status: "error"; message: string };

function VerifyBody() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<State>(token ? { status: "working" } : { status: "idle" });
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [resent, setResent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api("/auth/verify-email", { method: "POST", body: { token } })
      .then(() => setState({ status: "ok" }))
      .catch((err) =>
        setState({
          status: "error",
          message:
            err instanceof ApiError ? err.message : "Something went wrong — please try again.",
        }),
      );
  }, [token]);

  useEffect(() => {
    getCurrentUser()
      .then((user) => setSignedIn(Boolean(user)))
      .catch(() => setSignedIn(false));
  }, []);

  async function resend(event: React.FormEvent) {
    event.preventDefault();
    setResendError(null);
    try {
      await api("/auth/verify-email/resend", { method: "POST" });
      setResent(true);
    } catch (err) {
      setResendError(err instanceof ApiError ? err.message : "Could not resend the email.");
    }
  }

  if (token) {
    if (state.status === "working" || state.status === "idle") {
      return <p className="text-sm text-zinc-600 dark:text-zinc-400">Confirming your email…</p>;
    }
    if (state.status === "ok") {
      return (
        <div className="space-y-4">
          <SuccessBox>Your email address is confirmed — thanks!</SuccessBox>
          <Link
            href="/"
            className="inline-flex rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Continue to GuitarHub
          </Link>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <ErrorBox title={state.message} />
        <Link
          href="/forgot-password"
          className="text-sm font-medium text-zinc-700 underline dark:text-zinc-300"
        >
          Request a fresh link
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        We sent you a confirmation link — open it to verify your email address.
      </p>
      {resent ? <SuccessBox>Confirmation email sent again.</SuccessBox> : null}
      {resendError ? <ErrorBox title={resendError} /> : null}
      {signedIn === false ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <Link href="/login" className="font-medium underline">
            Sign in
          </Link>{" "}
          to request a new confirmation email.
        </p>
      ) : signedIn === true ? (
        <form onSubmit={resend}>
          <Button type="submit">Resend confirmation email</Button>
        </form>
      ) : null}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Confirm your email
        </h1>
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <Suspense>
            <VerifyBody />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
