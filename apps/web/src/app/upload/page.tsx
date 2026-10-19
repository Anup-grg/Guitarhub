"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import SiteHeader from "@/components/site-header";
import { api, ApiError, getCurrentUser, type SelfUser } from "@/lib/api";
import { Button, ErrorBox, Field, SuccessBox, inputClass } from "@/components/ui";
import type { PedalSummary } from "@/lib/api";

type InspectReport = {
  contentHash: string;
  size: number;
  kind: "file" | "bundle";
  filename: string;
  extracted: {
    title?: string | null;
    device?: string | null;
    firmwareVersion?: string | null;
    model?: string | null;
    artist?: string | null;
    description?: string | null;
  };
  duplicateOf: string | null;
};

type UploadedFile = { file: File; key: string };

type CreatedPreset = { id: string; title: string; status: string };

type UserState = "loading" | "anon" | SelfUser;

function parseTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, 5);
}

function errorMessage(err: unknown): { message: string; issues: string[] } {
  if (err instanceof ApiError) {
    return { message: err.message, issues: err.issues.map((i) => i.message) };
  }
  return { message: "Something went wrong", issues: [] };
}

export default function UploadPage() {
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
      <UploadContent />
    </Suspense>
  );
}

function UploadContent() {
  const searchParams = useSearchParams();
  const [user, setUser] = useState<UserState>("loading");
  const [pedals, setPedals] = useState<PedalSummary[]>([]);
  const [loadError, setLoadError] = useState<{ message: string; issues: string[] } | null>(null);

  const [selectedSlug, setSelectedSlug] = useState(() => searchParams?.get("pedal") ?? "");
  const [section, setSection] = useState<"general" | "songs">("general");
  const [title, setTitle] = useState("");
  const [descriptionMd, setDescriptionMd] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [year, setYear] = useState("");
  const [firmwareVersion, setFirmwareVersion] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [cloudUrl, setCloudUrl] = useState("");
  const [licenseAttested, setLicenseAttested] = useState(false);
  const [forkAck, setForkAck] = useState(false);
  const [usesThirdPartyIr, setUsesThirdPartyIr] = useState(false);

  const [primary, setPrimary] = useState<UploadedFile | null>(null);
  const [irFiles, setIrFiles] = useState<UploadedFile[]>([]);
  const [inspect, setInspect] = useState<InspectReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; issues: string[] } | null>(null);
  const [created, setCreated] = useState<CreatedPreset | null>(null);

  const primaryInputRef = useRef<HTMLInputElement>(null);
  const irInputRef = useRef<HTMLInputElement>(null);

  const pedal = useMemo(
    () => pedals.find((p) => p.slug === selectedSlug) ?? null,
    [pedals, selectedSlug],
  );
  const cloudOnly = pedal?.validationMode === "CLOUD_LINK";

  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then((found) => {
        if (!cancelled) setUser(found ?? "anon");
      })
      .catch(() => {
        if (!cancelled) setUser("anon");
      });
    api<{ pedals: PedalSummary[] }>("/pedals")
      .then((data) => {
        if (!cancelled) setPedals(data.pedals);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function applyExtraction(report: InspectReport) {
    setInspect(report);
    const extracted = report.extracted ?? {};
    if (!title.trim() && extracted.title) setTitle(extracted.title);
    if (!firmwareVersion.trim() && extracted.firmwareVersion) {
      setFirmwareVersion(extracted.firmwareVersion);
    }
  }

  async function uploadFile(
    slug: string,
    file: File,
    role: "primary" | "ir",
  ): Promise<UploadedFile> {
    const slot = await api<{ url: string; key: string; headers: Record<string, string> }>(
      "/presets/upload-url",
      { method: "POST", body: { pedalSlug: slug, filename: file.name, size: file.size, role } },
    );
    const put = await fetch(slot.url, { method: "PUT", headers: slot.headers, body: file });
    if (!put.ok) {
      throw new ApiError(put.status, "UPLOAD_FAILED", "The upload itself failed — try again");
    }
    return { file, key: slot.key };
  }

  async function handlePrimaryFile(file: File | undefined) {
    if (!file || !pedal) return;
    setPrimary(null);
    setInspect(null);
    setError(null);
    setForkAck(false);
    try {
      setBusy("Uploading preset file…");
      const uploaded = await uploadFile(pedal.slug, file, "primary");
      setBusy("Validating file…");
      const report = await api<InspectReport>("/presets/inspect", {
        method: "POST",
        body: { pedalSlug: pedal.slug, key: uploaded.key },
      });
      setPrimary(uploaded);
      applyExtraction(report);
      setBusy(null);
    } catch (err) {
      setBusy(null);
      setError(errorMessage(err));
    }
  }

  async function handleIrFiles(files: FileList | null) {
    if (!files || !pedal || files.length === 0) return;
    setError(null);
    const picked = Array.from(files).slice(0, 4);
    try {
      setBusy(`Uploading ${picked.length} companion file${picked.length === 1 ? "" : "s"}…`);
      const uploaded: UploadedFile[] = [];
      for (const file of picked) {
        uploaded.push(await uploadFile(pedal.slug, file, "ir"));
      }
      setIrFiles((prev) => [...prev, ...uploaded].slice(0, 4));
      if (picked.length > 0) setUsesThirdPartyIr(true);
      setBusy(null);
    } catch (err) {
      setBusy(null);
      setError(errorMessage(err));
    }
  }

  function removeIr(key: string) {
    setIrFiles((prev) => prev.filter((f) => f.key !== key));
  }

  const canSubmit =
    !busy &&
    !created &&
    Boolean(pedal) &&
    licenseAttested &&
    title.trim().length >= 2 &&
    Boolean(firmwareVersion.trim()) &&
    (section !== "songs" || (songTitle.trim().length > 0 && artist.trim().length > 0)) &&
    (section !== "general" || parseTags(tagsRaw).length > 0) &&
    (!inspect?.duplicateOf || forkAck) &&
    (cloudOnly ? cloudUrl.trim().length > 0 : Boolean(primary));

  async function submit(status: "published" | "draft") {
    if (!pedal) return;
    setBusy(status === "draft" ? "Saving draft…" : "Publishing…");
    setError(null);
    try {
      const body: Record<string, unknown> = {
        pedalSlug: pedal.slug,
        section,
        title: title.trim(),
        descriptionMd: descriptionMd.trim(),
        firmwareVersion: firmwareVersion.trim(),
        kind: cloudOnly ? "cloud_link" : "file",
        tags: parseTags(tagsRaw),
        usesThirdPartyIr,
        licenseAttested,
        forkAck,
        status,
      };
      if (section === "songs") {
        body.songTitle = songTitle.trim();
        body.artist = artist.trim();
        if (album.trim()) body.album = album.trim();
        const yearNum = Number(year);
        if (year.trim() && Number.isInteger(yearNum)) body.year = yearNum;
      }
      if (cloudOnly) {
        body.cloudUrl = cloudUrl.trim();
      }
      body.files = cloudOnly
        ? []
        : [
            ...(primary ? [{ key: primary.key, role: "primary" }] : []),
            ...irFiles.map((f) => ({ key: f.key, role: "ir" })),
          ];
      const result = await api<{ preset: CreatedPreset }>("/presets", {
        method: "POST",
        body,
      });
      setCreated(result.preset);
      setBusy(null);
    } catch (err) {
      setBusy(null);
      setError(errorMessage(err));
    }
  }

  if (user === "loading") {
    return (
      <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
        <SiteHeader />
        <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
          <p className="text-sm text-zinc-500" aria-busy="true">
            Loading…
          </p>
        </main>
      </div>
    );
  }

  if (user === "anon") {
    return (
      <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
        <SiteHeader />
        <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
          <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
            Sign in to upload presets.{" "}
            <Link href="/login" className="font-medium underline">
              Sign in
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Share a preset
        </h1>

        {created ? (
          <div className="mt-8 space-y-4">
            <SuccessBox>
              {created.status === "draft"
                ? `“${created.title}” was saved as a draft.`
                : `“${created.title}” is published — thanks for sharing!`}
            </SuccessBox>
            <div className="flex gap-3">
              <Link
                href="/pedals"
                className="inline-flex items-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Back to pedals
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            {loadError ? <ErrorBox title={loadError.message} issues={loadError.issues} /> : null}
            {error ? <ErrorBox title={error.message} issues={error.issues} /> : null}
            {busy ? (
              <p
                className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400"
                aria-busy="true"
              >
                {busy}
              </p>
            ) : null}

            <Field label="Pedal" htmlFor="pedal">
              <select
                id="pedal"
                className={inputClass}
                value={selectedSlug}
                onChange={(e) => {
                  setSelectedSlug(e.target.value);
                  setPrimary(null);
                  setInspect(null);
                  setIrFiles([]);
                }}
              >
                <option value="">Choose your pedal…</option>
                {pedals.map((p) => (
                  <option key={p.id} value={p.slug}>
                    {p.brand} — {p.model}
                  </option>
                ))}
              </select>
            </Field>

            {pedal && !cloudOnly ? (
              <div className="space-y-3">
                <Field
                  label="Preset file"
                  htmlFor="primary-file"
                  hint={`Accepted: ${pedal.extensions.map((e) => `.${e}`).join(", ")}`}
                >
                  <input
                    ref={primaryInputRef}
                    id="primary-file"
                    type="file"
                    className={inputClass}
                    accept={pedal.extensions.map((e) => `.${e}`).join(",")}
                    onChange={(e) => void handlePrimaryFile(e.target.files?.[0])}
                  />
                </Field>
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    void handlePrimaryFile(e.dataTransfer.files?.[0]);
                  }}
                  className="rounded-md border border-dashed border-zinc-300 px-4 py-4 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
                >
                  …or drop the file here
                </div>
                {inspect ? (
                  <div className="space-y-3">
                    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
                      <p className="font-medium text-zinc-800 dark:text-zinc-200">
                        {inspect.filename} · {inspect.size} bytes
                      </p>
                      <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                        {[
                          inspect.extracted.title && `name “${inspect.extracted.title}”`,
                          inspect.extracted.device && `device ${inspect.extracted.device}`,
                          inspect.extracted.firmwareVersion &&
                            `firmware ${inspect.extracted.firmwareVersion}`,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "No metadata extracted — fill in the fields below"}
                      </p>
                    </div>
                    {inspect.duplicateOf && !forkAck ? (
                      <div
                        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
                        role="status"
                      >
                        <p className="font-medium">An identical published preset already exists.</p>
                        <label className="mt-2 flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={forkAck}
                            onChange={(e) => setForkAck(e.target.checked)}
                          />
                          Publish anyway as a forked/updated version
                        </label>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <Field
                  label="Companion IR files (optional)"
                  htmlFor="ir-files"
                  hint="WAV/IR files, up to 4"
                >
                  <input
                    ref={irInputRef}
                    id="ir-files"
                    type="file"
                    multiple
                    className={inputClass}
                    onChange={(e) => void handleIrFiles(e.target.files)}
                  />
                </Field>
                {irFiles.length > 0 ? (
                  <ul className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {irFiles.map((f) => (
                      <li key={f.key} className="flex items-center justify-between gap-3">
                        <span>{f.file.name}</span>
                        <button
                          type="button"
                          onClick={() => removeIr(f.key)}
                          className="text-xs font-medium text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {pedal && cloudOnly ? (
              <Field
                label="Cortex Cloud share URL"
                htmlFor="cloud-url"
                hint="Paste the share link from Cortex Cloud"
              >
                <input
                  id="cloud-url"
                  type="url"
                  className={inputClass}
                  placeholder="https://cloud.neuraldsp.com/…"
                  value={cloudUrl}
                  onChange={(e) => setCloudUrl(e.target.value)}
                />
              </Field>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Section" htmlFor="section">
                <select
                  id="section"
                  className={inputClass}
                  value={section}
                  onChange={(e) => setSection(e.target.value as "general" | "songs")}
                >
                  <option value="general">General</option>
                  <option value="songs">Songs</option>
                </select>
              </Field>
              <Field label="Name" htmlFor="title" hint="2–120 characters">
                <input
                  id="title"
                  className={inputClass}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                />
              </Field>
            </div>

            <Field label="Description (Markdown)" htmlFor="description">
              <textarea
                id="description"
                className={`${inputClass} min-h-24`}
                value={descriptionMd}
                onChange={(e) => setDescriptionMd(e.target.value)}
                maxLength={5000}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Firmware / editor version" htmlFor="firmware" hint="Required">
                <input
                  id="firmware"
                  className={inputClass}
                  value={firmwareVersion}
                  onChange={(e) => setFirmwareVersion(e.target.value)}
                  maxLength={40}
                />
              </Field>
              <Field label="Tags" htmlFor="tags" hint="Comma-separated, max 5">
                <input
                  id="tags"
                  className={inputClass}
                  value={tagsRaw}
                  onChange={(e) => setTagsRaw(e.target.value)}
                  placeholder="ambient, worship"
                />
              </Field>
            </div>

            {section === "songs" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Song title" htmlFor="song-title">
                  <input
                    id="song-title"
                    className={inputClass}
                    value={songTitle}
                    onChange={(e) => setSongTitle(e.target.value)}
                    maxLength={200}
                  />
                </Field>
                <Field label="Artist" htmlFor="song-artist">
                  <input
                    id="song-artist"
                    className={inputClass}
                    value={artist}
                    onChange={(e) => setArtist(e.target.value)}
                    maxLength={200}
                  />
                </Field>
                <Field label="Album (optional)" htmlFor="song-album">
                  <input
                    id="song-album"
                    className={inputClass}
                    value={album}
                    onChange={(e) => setAlbum(e.target.value)}
                    maxLength={200}
                  />
                </Field>
                <Field label="Year (optional)" htmlFor="song-year">
                  <input
                    id="song-year"
                    type="number"
                    min={1900}
                    max={2100}
                    className={inputClass}
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            {!cloudOnly && irFiles.length > 0 ? (
              <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={usesThirdPartyIr}
                  onChange={(e) => setUsesThirdPartyIr(e.target.checked)}
                />
                I used third-party IRs in this preset
              </label>
            ) : null}

            <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={licenseAttested}
                onChange={(e) => setLicenseAttested(e.target.checked)}
              />
              <span>
                This preset is my own work — I am not redistributing paid preset packs or
                copyrighted IRs.
              </span>
            </label>

            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                disabled={!canSubmit}
                busy={busy === "Publishing…"}
                onClick={() => void submit("published")}
              >
                Publish
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!canSubmit}
                busy={busy === "Saving draft…"}
                onClick={() => void submit("draft")}
              >
                Save draft
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
