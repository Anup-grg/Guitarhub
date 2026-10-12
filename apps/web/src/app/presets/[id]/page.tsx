"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import SiteHeader from "@/components/site-header";
import PresetVote from "@/components/preset-vote";
import PresetComments from "@/components/preset-comments";
import { ApiError, getCurrentUser, getPreset, type PresetDetail, type SelfUser } from "@/lib/api";
import { Button, ErrorBox } from "@/components/ui";

type State =
  | { status: "loading" }
  | { status: "notfound" }
  | { status: "error"; message: string; issues: string[] }
  | { status: "ready"; preset: PresetDetail; viewer: SelfUser | null };

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString();
}

export default function PresetDetailPage() {
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
      <PresetDetailContent />
    </Suspense>
  );
}

function PresetDetailContent() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    Promise.all([getPreset(id), getCurrentUser()])
      .then(([preset, viewer]) => {
        if (!cancelled) setState({ status: "ready", preset, viewer });
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
  }, [id]);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link href="/presets" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          ← Browse presets
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
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Preset not found</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              This preset does not exist or has not been published yet.
            </p>
            <Link href="/presets" className="inline-block text-sm font-medium underline">
              Browse presets
            </Link>
          </div>
        ) : null}

        {state.status === "ready" ? <PresetBody preset={state.preset} viewer={state.viewer} /> : null}
      </main>
    </div>
  );
}

function PresetBody({ preset, viewer }: { preset: PresetDetail; viewer: SelfUser | null }) {
  const [downloadBusy, setDownloadBusy] = useState(false);

  const isCloud = preset.kind === "cloud_link";
  const downloadUrl = `/api/v1/presets/${preset.id}/download`;

  function startDownload() {
    setDownloadBusy(true);
    if (isCloud) {
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
      setDownloadBusy(false);
    } else {
      const a = window.document.createElement("a");
      a.href = downloadUrl;
      a.rel = "noopener";
      a.download = "";
      window.document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => setDownloadBusy(false), 400);
    }
  }

  const isSong = preset.section === "songs";

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
          {isSong ? "Songs" : "General"}
        </span>
        {preset.tags.map((t) => (
          <span
            key={t.slug}
            className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
          >
            {t.label}
          </span>
        ))}
      </div>

      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {preset.title}
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        by {preset.user.displayName}
        {preset.user.verified ? " (verified)" : ""} · uploaded {formatDate(preset.createdAt)} ·{" "}
        <Link
          href={`/pedals/${preset.pedal.slug}`}
          className="underline hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          {preset.pedal.brand} {preset.pedal.model}
        </Link>
      </p>

      {preset.firmwareWarning ? (
        <div
          role="alert"
          className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
        >
          {preset.firmwareWarning} Make sure your device is updated before importing.
        </div>
      ) : null}

      {preset.usesThirdPartyIr ? (
        <div
          role="note"
          className="mt-3 rounded-md border border-zinc-300 bg-zinc-100 px-4 py-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        >
          This preset uses third-party IRs (impulse responses). You may need to download them
          separately for the tone to sound right.
        </div>
      ) : null}

      <dl className="mt-6 grid gap-4 rounded-xl border border-zinc-200 bg-white p-5 text-sm dark:border-zinc-800 dark:bg-zinc-950 sm:grid-cols-2">
        <div>
          <dt className="font-medium text-zinc-500 dark:text-zinc-400">Firmware</dt>
          <dd className="mt-1 text-zinc-800 dark:text-zinc-200">{preset.firmwareVersion}</dd>
        </div>
        <div>
          <dt className="font-medium text-zinc-500 dark:text-zinc-400">File</dt>
          <dd className="mt-1 text-zinc-800 dark:text-zinc-200">
            {isCloud ? "Cortex Cloud link" : preset.fileExt ? `.${preset.fileExt}` : "—"}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-zinc-500 dark:text-zinc-400">Size</dt>
          <dd className="mt-1 text-zinc-800 dark:text-zinc-200">
            {isCloud ? "—" : formatBytes(preset.fileSize)}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-zinc-500 dark:text-zinc-400">Downloads</dt>
          <dd className="mt-1 text-zinc-800 dark:text-zinc-200">{preset.counts.downloads}</dd>
        </div>
        <div>
          <dt className="font-medium text-zinc-500 dark:text-zinc-400">Rating</dt>
          <dd className="mt-1 text-zinc-800 dark:text-zinc-200">
            <PresetVote
              presetId={preset.id}
              score={preset.counts.score}
              up={preset.counts.up}
              down={preset.counts.down}
              userVote={preset.userVote}
              mine={preset.mine}
              signedIn={Boolean(viewer)}
            />
          </dd>
        </div>
        <div>
          <dt className="font-medium text-zinc-500 dark:text-zinc-400">Engagement</dt>
          <dd className="mt-1 text-zinc-800 dark:text-zinc-200">
            {preset.counts.comments} comments · {preset.counts.views} views
          </dd>
        </div>
      </dl>

      {isSong ? (
        <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-5 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-zinc-800 dark:text-zinc-200">
            Song: <span className="font-medium">{preset.songTitle}</span>
            {preset.artist ? ` — ${preset.artist}` : null}
            {preset.album ? ` · ${preset.album}` : null}
            {preset.year ? ` · ${preset.year}` : null}
          </p>
        </div>
      ) : null}

      {preset.descriptionMd ? (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            About this preset
          </h2>
          <div className="mt-3 whitespace-pre-wrap rounded-xl border border-zinc-200 bg-white p-5 text-sm leading-6 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
            {preset.descriptionMd}
          </div>
        </section>
      ) : null}

      {preset.pedal.importInstructionsMd ? (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            How to import
          </h2>
          <div className="mt-3 whitespace-pre-wrap rounded-xl border border-zinc-200 bg-white p-5 text-sm leading-6 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
            {preset.pedal.importInstructionsMd}
          </div>
        </section>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Button onClick={startDownload} busy={downloadBusy} type="button" disabled={downloadBusy}>
          {isCloud ? "Open in Cortex Cloud" : "Download preset"}
        </Button>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {isCloud
            ? "Opens in a new tab on Cortex Cloud."
            : "The download link is generated on request and expires shortly."}
        </span>
      </div>

      <PresetComments presetId={preset.id} signedIn={Boolean(viewer)} currentUserId={viewer?.id ?? null} />

      {preset.files.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Included files
          </h2>
          <ul className="mt-3 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white text-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
            {preset.files.map((file) => (
              <li
                key={`${file.role}-${file.ext}`}
                className="flex items-center justify-between px-4 py-3 text-zinc-700 dark:text-zinc-300"
              >
                <span className="flex items-center gap-2">
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                    {file.role}
                  </span>
                  .{file.ext}
                </span>
                <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  {formatBytes(file.size)} · sha256:{file.contentHash.slice(0, 12)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}