"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, getCurrentUser, type SelfUser } from "@/lib/api";

type State = { status: "loading" } | { status: "anon" } | { status: "user"; user: SelfUser };

export default function AuthNav() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then((user) => {
        if (!cancelled) setState(user ? { status: "user", user } : { status: "anon" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "anon" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // Session may already be gone — drop the UI state regardless.
    }
    setState({ status: "anon" });
  }

  if (state.status === "loading") {
    return <span className="text-sm text-zinc-400" aria-busy="true">…</span>;
  }

  if (state.status === "anon") {
    return (
      <nav aria-label="Account" className="flex items-center gap-3 text-sm">
        <Link
          href="/login"
          className="font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
        >
          Sign in
        </Link>
        <Link
          href="/register"
          className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          Create account
        </Link>
      </nav>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      {state.user.role === "ADMIN" ? (
        <Link
          href="/admin"
          className="font-medium text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
        >
          Admin
        </Link>
      ) : null}
      <Link
        href="/settings"
        className="font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
      >
        {state.user.displayName}
      </Link>
      <button
        type="button"
        onClick={signOut}
        className="rounded-md border border-zinc-300 px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        Sign out
      </button>
    </div>
  );
}
