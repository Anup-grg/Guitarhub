"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listPresets, type PresetItem } from "@/lib/api";

type State =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      hot: PresetItem[];
      newest: PresetItem[];
      pedals: { slug: string; brand: string; model: string; presetCount: number }[];
    };

export default function HomeFeeds() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listPresets({ sort: "hot", limit: 5 }).catch(() => null),
      listPresets({ sort: "new", limit: 5 }).catch(() => null),
      fetch("/api/v1/pedals")
        .then((r) => (r.ok ? r.json() : { pedals: [] }))
        .then((d) => d.pedals as { slug: string; brand: string; model: string; presetCount: number }[]),
    ])
      .then(([hot, newest, pedals]) => {
        if (cancelled) return;
        setState({
          status: "ready",
          hot: hot?.presets ?? [],
          newest: newest?.presets ?? [],
          pedals: pedals.slice(0, 8),
        });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading" || state.status === "error") {
    return (
      <p className="mt-8 text-sm text-zinc-500" aria-busy={state.status === "loading"}>
        {state.status === "loading" ? "Loading feeds…" : "Feeds are unavailable right now."}
      </p>
    );
  }

  return (
    <div className="mt-10 space-y-10">
      <form
        className="flex max-w-xl gap-2"
        action="/presets"
        onSubmit={(e) => {
          if (!q.trim()) e.preventDefault();
        }}
      >
        <input
          aria-label="Search presets"
          name="q"
          defaultValue={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search presets — try “clean”, “helix”, or an artist…"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          Search
        </button>
      </form>

      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Trending now
          </h2>
          <Link href="/presets?sort=hot" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
            See all →
          </Link>
        </div>
        {state.status === "ready" ? (
          <PresetRows presets={state.hot} empty="Nothing trending yet — be the first to share." />
        ) : null}
      </section>

      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Newest presets
          </h2>
          <Link href="/presets?sort=new" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
            See all →
          </Link>
        </div>
        {state.status === "ready" ? (
          <PresetRows presets={state.newest} empty="No presets published yet." />
        ) : null}
      </section>

      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Pedals
          </h2>
          <Link href="/pedals" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
            Full catalog →
          </Link>
        </div>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {state.status === "ready"
            ? state.pedals.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/pedals/${p.slug}`}
                    className="block rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
                  >
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {p.brand} {p.model}
                    </span>
                    <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {p.presetCount} preset{p.presetCount === 1 ? "" : "s"}
                    </span>
                  </Link>
                </li>
              ))
            : null}
        </ul>
      </section>
    </div>
  );
}

function PresetRows({ presets, empty }: { presets: PresetItem[]; empty: string }) {
  if (presets.length === 0) {
    return (
      <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400" data-testid="feed-empty">
        {empty}
      </p>
    );
  }
  return (
    <ul className="mt-3 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
      {presets.map((preset) => (
        <li key={preset.id}>
          <Link
            href={`/presets/${preset.id}`}
            className="flex items-baseline justify-between gap-4 px-4 py-3 transition hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <span className="font-medium text-zinc-900 dark:text-zinc-50">{preset.title}</span>
            <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
              {preset.pedal.brand} {preset.pedal.model} · ▲ {preset.counts.score}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}