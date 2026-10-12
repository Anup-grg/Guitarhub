"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import SiteHeader from "@/components/site-header";
import { api, ApiError, listPresets, type PresetItem } from "@/lib/api";
import { ErrorBox, Field, inputClass } from "@/components/ui";
import type { PedalSummary } from "@/lib/api";

const SORTS = [
  { value: "hot", label: "Trending" },
  { value: "new", label: "Newest" },
  { value: "top", label: "Top rated" },
  { value: "downloads", label: "Most downloaded" },
  { value: "comments", label: "Most commented" },
] as const;

type State =
  | { status: "loading" }
  | { status: "error"; message: string; issues: string[] }
  | { status: "ready"; presets: PresetItem[]; nextCursor: string | null; total: number };

export default function PresetsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
          <SiteHeader />
          <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
            <p className="text-sm text-zinc-500" aria-busy="true">
              Loading…
            </p>
          </main>
        </div>
      }
    >
      <PresetsContent />
    </Suspense>
  );
}

function PresetsContent() {
  const searchParams = useSearchParams();
  const [pedals, setPedals] = useState<PedalSummary[]>([]);

  const [pedal, setPedal] = useState(searchParams.get("pedal") ?? "");
  const [section, setSection] = useState(searchParams.get("section") ?? "");
  const [tag, setTag] = useState(searchParams.get("tag") ?? "");
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [sort, setSort] = useState<string>(searchParams.get("sort") ?? "hot");
  const [usesIr, setUsesIr] = useState(false);
  const [verified, setVerified] = useState(false);
  const [pendingQ, setPendingQ] = useState(q);

  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    api<{ pedals: PedalSummary[] }>("/pedals")
      .then((data) => {
        if (!cancelled) setPedals(data.pedals);
      })
      .catch(() => {
        if (!cancelled) setPedals([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = {
      pedal: pedal || undefined,
      section: section || undefined,
      tag: tag || undefined,
      q: q || undefined,
      sort: sort as "hot" | "new" | "top" | "downloads" | "comments",
      usesIr: usesIr || undefined,
      verified: verified || undefined,
      limit: 20,
    };
    listPresets(params)
      .then((data) => {
        if (!cancelled) {
          setState({ status: "ready", presets: data.presets, nextCursor: data.nextCursor, total: data.total });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setState({ status: "error", message: err.message, issues: err.issues.map((i) => i.message) });
        } else {
          setState({ status: "error", message: "Something went wrong", issues: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pedal, section, tag, q, sort, usesIr, verified]);

  function applyFilter<S>(setter: (value: S) => void, value: S) {
    setState({ status: "loading" });
    setter(value);
  }

  function loadMore(nextCursor: string | null) {
    if (!nextCursor) return;
    const params = {
      pedal: pedal || undefined,
      section: section || undefined,
      tag: tag || undefined,
      q: q || undefined,
      sort: sort as "hot" | "new" | "top" | "downloads" | "comments",
      usesIr: usesIr || undefined,
      verified: verified || undefined,
      cursor: nextCursor,
      limit: 20,
    };
    listPresets(params)
      .then((data) => {
        setState((prev) =>
          prev.status === "ready"
            ? {
                status: "ready",
                presets: [...prev.presets, ...data.presets],
                nextCursor: data.nextCursor,
                total: data.total,
              }
            : prev,
        );
      })
      .catch(() => undefined);
  }

  const activeSort = SORTS.find((s) => s.value === sort)?.label ?? "Trending";

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Browse presets
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Discover community presets — filter by pedal, section and tags, or search across
          titles, songs, artists and creators.
        </p>

        <form
          className="mt-8 grid gap-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            setState({ status: "loading" });
            setQ(pendingQ.trim());
          }}
        >
          <div className="sm:col-span-2">
            <Field label="Search" htmlFor="preset-search">
              <input
                id="preset-search"
                className={inputClass}
                placeholder="Title, song, artist, tag or creator…"
                value={pendingQ}
                onChange={(e) => setPendingQ(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Pedal" htmlFor="f-pedal">
            <select
              id="f-pedal"
              className={inputClass}
              value={pedal}
              onChange={(e) => applyFilter(setPedal, e.target.value)}
            >
              <option value="">All pedals</option>
              {pedals.map((p) => (
                <option key={p.id} value={p.slug}>
                  {p.brand} {p.model}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Section" htmlFor="f-section">
            <select
              id="f-section"
              className={inputClass}
              value={section}
              onChange={(e) => applyFilter(setSection, e.target.value)}
            >
              <option value="">All sections</option>
              <option value="general">General</option>
              <option value="songs">Songs</option>
            </select>
          </Field>
          <Field label="Tag" htmlFor="f-tag">
            <input
              id="f-tag"
              className={inputClass}
              placeholder="e.g. clean"
              value={tag}
              onChange={(e) => applyFilter(setTag, e.target.value)}
            />
          </Field>
          <Field label="Sort" htmlFor="f-sort">
            <select
              id="f-sort"
              className={inputClass}
              value={sort}
              onChange={(e) => applyFilter(setSort, e.target.value)}
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-center gap-4 pt-6 text-sm sm:col-span-2 lg:col-span-2">
            <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={usesIr}
                onChange={(e) => applyFilter(setUsesIr, e.target.checked)}
              />
              Uses custom IRs
            </label>
            <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={verified}
                onChange={(e) => applyFilter(setVerified, e.target.checked)}
              />
              Verified creator
            </label>
            <button
              type="submit"
              className="ml-auto rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              Search
            </button>
          </div>
        </form>

        <div className="mt-8 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {state.status === "ready" ? `${state.total} preset${state.total === 1 ? "" : "s"}` : ""}
          </h2>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Sorted by {activeSort.toLowerCase()}
          </span>
        </div>

        {state.status === "loading" ? (
          <p className="mt-6 text-sm text-zinc-500" aria-busy="true">
            Loading presets…
          </p>
        ) : null}

        {state.status === "error" ? (
          <div className="mt-6">
            <ErrorBox title={state.message} issues={state.issues} />
          </div>
        ) : null}

        {state.status === "ready" && state.presets.length === 0 ? (
          <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
            No presets match your filters yet — be the first to share one.
          </p>
        ) : null}

        {state.status === "ready" && state.presets.length > 0 ? (
          <>
            <ul className="mt-4 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
              {state.presets.map((preset) => (
                <PresetCard key={preset.id} preset={preset} />
              ))}
            </ul>
            {state.nextCursor ? (
              <button
                type="button"
                onClick={() => loadMore(state.nextCursor)}
                className="mt-6 inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Load more presets
              </button>
            ) : null}
          </>
        ) : null}
      </main>
    </div>
  );
}

function PresetCard({ preset }: { preset: PresetItem }) {
  return (
    <li>
      <Link
        href={`/presets/${preset.id}`}
        className="block px-5 py-4 transition hover:bg-zinc-50 dark:hover:bg-zinc-900"
      >
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-semibold text-zinc-900 dark:text-zinc-50">{preset.title}</p>
          <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
            {preset.pedal.brand} {preset.pedal.model}
          </span>
        </div>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {preset.section === "songs" && preset.songTitle
            ? `“${preset.songTitle}” — ${preset.artist ?? "unknown artist"}`
            : preset.descriptionMd
              ? preset.descriptionMd
              : `Firmware ${preset.firmwareVersion}`}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-500 dark:text-zinc-400">
          {preset.tags.length > 0 ? (
            <span>
              {preset.tags.map((t) => t.label).join(" · ")}
            </span>
          ) : null}
          <span>
            by {preset.user.displayName}
            {preset.user.verified ? " ✓" : ""}
          </span>
          <span>
            ▲ {preset.counts.score} · {preset.counts.comments} comments ·{" "}
            {preset.counts.downloads} downloads
          </span>
        </div>
      </Link>
    </li>
  );
}