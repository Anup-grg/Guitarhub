"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import SiteHeader from "@/components/site-header";
import { getCurrentUser } from "@/lib/api";

type State =
  | { status: "loading" }
  | { status: "anon" }
  | { status: "forbidden" }
  | { status: "ready" };

const ADMIN_LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/pedals", label: "Pedals" },
  { href: "/admin/tags", label: "Tags" },
];

/** Renders admin-only content, gating on the signed-in user's role (FR-7). */
export default function AdminGate({ title, children }: { title: string; children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then((user) => {
        if (cancelled) return;
        if (!user) setState({ status: "anon" });
        else if (user.role !== "ADMIN") setState({ status: "forbidden" });
        else setState({ status: "ready" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "anon" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {title}
        </h1>
        {state.status === "ready" ? (
          <nav className="mt-4 flex flex-wrap gap-3 border-b border-zinc-200 pb-3 text-sm dark:border-zinc-800">
            {ADMIN_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        ) : null}

        {state.status === "loading" ? (
          <p className="mt-8 text-sm text-zinc-500" aria-busy="true">
            Checking access…
          </p>
        ) : null}

        {state.status === "anon" ? (
          <p className="mt-8 text-sm text-zinc-600 dark:text-zinc-400">
            Please{" "}
            <Link href="/login" className="font-medium underline">
              sign in
            </Link>{" "}
            with an administrator account.
          </p>
        ) : null}

        {state.status === "forbidden" ? (
          <p role="alert" className="mt-8 text-sm text-red-700 dark:text-red-400">
            Administrator access is required to view this page.
          </p>
        ) : null}

        {state.status === "ready" ? <div className="mt-8">{children}</div> : null}
      </main>
    </div>
  );
}
