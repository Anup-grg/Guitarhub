"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import SiteHeader from "@/components/site-header";
import { ApiError, listPedals, type PedalSummary } from "@/lib/api";
import { ErrorBox } from "@/components/ui";

type State =
  | { status: "loading" }
  | { status: "error"; message: string; issues: string[] }
  | { status: "ready"; pedals: PedalSummary[] };

export default function PedalsPage() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    listPedals()
      .then((pedals) => {
        if (!cancelled) setState({ status: "ready", pedals });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setState({
            status: "error",
            message: err.message,
            issues: err.issues.map((i) => i.message),
          });
        } else {
          setState({ status: "error", message: "Something went wrong", issues: [] });
        }
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
          Pedal catalog
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Pick your pedal to see accepted formats, size limits and how to import presets into your
          editor.
        </p>

        {state.status === "loading" ? (
          <p className="mt-8 text-sm text-zinc-500" aria-busy="true">
            Loading pedals…
          </p>
        ) : null}

        {state.status === "error" ? (
          <div className="mt-8">
            <ErrorBox title={state.message} issues={state.issues} />
          </div>
        ) : null}

        {state.status === "ready" && state.pedals.length === 0 ? (
          <p className="mt-8 text-sm text-zinc-500">No pedals in the catalog yet.</p>
        ) : null}

        {state.status === "ready" && state.pedals.length > 0 ? (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {state.pedals.map((pedal) => (
              <li key={pedal.id}>
                <Link
                  href={`/pedals/${pedal.slug}`}
                  className="block rounded-xl border border-zinc-200 bg-white p-5 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    {pedal.brand}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    {pedal.model}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    {pedal.validationMode === "CLOUD_LINK" ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        Cortex Cloud link
                      </span>
                    ) : (
                      pedal.extensions.map((ext) => (
                        <span
                          key={ext}
                          className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                        >
                          .{ext}
                        </span>
                      ))
                    )}
                    <span className="text-zinc-500 dark:text-zinc-400">
                      {pedal.presetCount} preset{pedal.presetCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </main>
    </div>
  );
}
