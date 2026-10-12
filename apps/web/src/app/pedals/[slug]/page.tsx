"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import SiteHeader from "@/components/site-header";
import { api, ApiError, listPresets, type PresetItem } from "@/lib/api";
import { ErrorBox } from "@/components/ui";

type PedalDetail = {
  id: string;
  brand: string;
  model: string;
  slug: string;
  validationMode: string;
  extensions: string[];
  maxPresetBytes: number;
  maxBundleBytes: number;
  maxCompanionBytes: number;
  presetCount: number;
  firmwareNotes: string | null;
  importInstructionsMd: string | null;
};

type State =
  | { status: "loading" }
  | { status: "notfound" }
  | { status: "error"; message: string; issues: string[] }
  | { status: "ready"; pedal: PedalDetail };

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export default function PedalDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
          <SiteHeader />
          <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
            <p className="text-sm text-zinc-500" aria-busy="true">
              Loading…
            </p>
          </main>
        </div>
      }
    >
      <PedalDetailContent />
    </Suspense>
  );
}

function PedalDetailContent() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    api<{ pedal: PedalDetail }>(`/pedals/${encodeURIComponent(slug)}`)
      .then((data) => {
        if (!cancelled) setState({ status: "ready", pedal: data.pedal });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ status: "notfound" });
        } else if (err instanceof ApiError) {
          setState({ status: "error", message: err.message, issues: err.issues.map((i) => i.message) });
        } else {
          setState({ status: "error", message: "Something went wrong", issues: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link href="/pedals" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          ← All pedals
        </Link>

        {state.status === "loading" ? (
          <p className="mt-8 text-sm text-zinc-500" aria-busy="true">
            Loading…
          </p>
        ) : null}

        {state.status === "error" ? (
          <div className="mt-8">
            <ErrorBox title={state.message} issues={state.issues} />
          </div>
        ) : null}

        {state.status === "notfound" ? (
          <div className="mt-8 space-y-4">
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              Pedal not found
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              This pedal is not in the catalog (or it has been disabled).
            </p>
            <Link href="/pedals" className="inline-block text-sm font-medium underline">
              Browse the catalog
            </Link>
          </div>
        ) : null}

        {state.status === "ready" ? (
          <>
            <p className="mt-4 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {state.pedal.brand}
            </p>
            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                {state.pedal.model}
              </h1>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {state.pedal.presetCount} preset{state.pedal.presetCount === 1 ? "" : "s"}
              </span>
            </div>

            <dl className="mt-6 grid gap-4 rounded-xl border border-zinc-200 bg-white p-5 text-sm dark:border-zinc-800 dark:bg-zinc-950 sm:grid-cols-2">
              <div>
                <dt className="font-medium text-zinc-500 dark:text-zinc-400">Sharing mode</dt>
                <dd className="mt-1 text-zinc-800 dark:text-zinc-200">
                  {state.pedal.validationMode === "CLOUD_LINK"
                    ? "Cortex Cloud link"
                    : "Preset file upload"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-zinc-500 dark:text-zinc-400">Accepted files</dt>
                <dd className="mt-1 text-zinc-800 dark:text-zinc-200">
                  {state.pedal.validationMode === "CLOUD_LINK"
                    ? "None — share a cloud link"
                    : state.pedal.extensions.map((e) => `.${e}`).join(", ")}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-zinc-500 dark:text-zinc-400">Preset size limit</dt>
                <dd className="mt-1 text-zinc-800 dark:text-zinc-200">
                  {formatBytes(state.pedal.maxPresetBytes)}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-zinc-500 dark:text-zinc-400">Companion IR limit</dt>
                <dd className="mt-1 text-zinc-800 dark:text-zinc-200">
                  {formatBytes(state.pedal.maxCompanionBytes)}
                </dd>
              </div>
            </dl>

            {state.pedal.firmwareNotes ? (
              <p className="mt-4 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                {state.pedal.firmwareNotes}
              </p>
            ) : null}

            {state.pedal.importInstructionsMd ? (
              <section className="mt-8">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  How to import
                </h2>
                <div className="mt-3 whitespace-pre-wrap rounded-xl border border-zinc-200 bg-white p-5 text-sm leading-6 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                  {state.pedal.importInstructionsMd}
                </div>
              </section>
            ) : null}

            <CommunityPresets slug={state.pedal.slug} />

            <div className="mt-8">
              <Link
                href={`/upload?pedal=${encodeURIComponent(state.pedal.slug)}`}
                className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                Upload a preset for the {state.pedal.model}
              </Link>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

function CommunityPresets({ slug }: { slug: string }) {
  const [items, setItems] = useState<PresetItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listPresets({ pedal: slug, sort: "top", limit: 5 })
      .then((data) => {
        if (!cancelled) setItems(data.presets ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Community presets
        </h2>
        <Link
          href={`/presets?pedal=${encodeURIComponent(slug)}`}
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          Browse all →
        </Link>
      </div>
      {items === null ? (
        <p className="mt-3 text-sm text-zinc-500" aria-busy="true">
          Loading…
        </p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          No presets shared for this pedal yet.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
          {items.map((preset) => (
            <li key={preset.id}>
              <Link
                href={`/presets/${preset.id}`}
                className="flex items-baseline justify-between gap-4 px-4 py-3 transition hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <span className="font-medium text-zinc-900 dark:text-zinc-50">{preset.title}</span>
                <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                  {preset.section} · ▲ {preset.counts.score} · {preset.counts.downloads} downloads
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
