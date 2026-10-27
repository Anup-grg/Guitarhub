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
        .then(
          (d) => d.pedals as { slug: string; brand: string; model: string; presetCount: number }[],
        ),
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
        {state.status === "loading" ? "Loading feedsâ€¦" : "Feeds are unavailable right now."}
      </p>
    );
  }

  return (
    <div className="space-y-16">
      <div>
        <form
          className="flex max-w-2xl mx-auto gap-0 shadow-sm"
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
            placeholder="Search presets by name, pedal, or artist..."
            className="w-full border border-gray-300 border-r-0 px-6 py-4 text-sm text-black placeholder:text-gray-500 focus:outline-none focus:border-black"
          />
          <button
            type="submit"
            className="shrink-0 bg-black px-10 py-4 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
          >
            SEARCH
          </button>
        </form>
      </div>

      <section>
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-black uppercase tracking-wide">
            Trending Now
          </h2>
          <Link
            href="/presets?sort=hot"
            className="text-sm font-medium text-black hover:underline transition-colors"
          >
            VIEW ALL
          </Link>
        </div>
        {state.status === "ready" ? (
          <PresetRows presets={state.hot} empty="Nothing trending yet - be the first to share." />
        ) : null}
      </section>

      <section>
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-black uppercase tracking-wide">
            Newest Presets
          </h2>
          <Link
            href="/presets?sort=new"
            className="text-sm font-medium text-black hover:underline transition-colors"
          >
            VIEW ALL
          </Link>
        </div>
        {state.status === "ready" ? (
          <PresetRows presets={state.newest} empty="No presets published yet." />
        ) : null}
      </section>

      <section>
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-black uppercase tracking-wide">
            Browse by Pedal
          </h2>
          <Link
            href="/pedals"
            className="text-sm font-medium text-black hover:underline transition-colors"
          >
            FULL CATALOG
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {state.status === "ready"
            ? state.pedals.map((p) => (
                <Link
                  key={p.slug}
                  href={`/pedals/${p.slug}`}
                  className="group border border-gray-200 p-6 text-center transition-all hover:border-black hover:shadow-sm"
                >
                  <div className="font-semibold text-black group-hover:text-gray-700">
                    {p.brand}
                  </div>
                  <div className="text-gray-600 text-sm mt-1">
                    {p.model}
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    {p.presetCount} {p.presetCount === 1 ? "PRESET" : "PRESETS"}
                  </div>
                </Link>
              ))
            : null}
        </div>
      </section>
    </div>
  );
}

function PresetRows({ presets, empty }: { presets: PresetItem[]; empty: string }) {
  if (presets.length === 0) {
    return (
      <p className="text-sm text-gray-500" data-testid="feed-empty">
        {empty}
      </p>
    );
  }
  return (
    <div className="border border-gray-200">
      {presets.map((preset, index) => (
        <Link
          key={preset.id}
          href={`/presets/${preset.id}`}
          className={`flex items-center justify-between gap-4 px-6 py-4 transition hover:bg-gray-50 ${
            index !== presets.length - 1 ? "border-b border-gray-200" : ""
          }`}
        >
          <div>
            <div className="font-medium text-black">{preset.title}</div>
            <div className="text-sm text-gray-600 mt-1">
              {preset.pedal.brand} {preset.pedal.model}
            </div>
          </div>
          <div className="text-sm text-gray-500">
            {preset.counts.score} {preset.counts.score === 1 ? "upvote" : "upvotes"}
          </div>
        </Link>
      ))}
    </div>
  );
}
