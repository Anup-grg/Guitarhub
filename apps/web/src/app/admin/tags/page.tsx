"use client";

import { useEffect, useState } from "react";
import AdminGate from "@/components/admin-gate";
import { Button, ErrorBox, Field, inputClass, SuccessBox } from "@/components/ui";
import {
  ApiError,
  createAdminTag,
  listAdminTags,
  mergeAdminTags,
  updateAdminTag,
  type AdminTag,
} from "@/lib/api";

function TagsPanel() {
  const [tags, setTags] = useState<AdminTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [merging, setMerging] = useState<AdminTag | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");

  async function refresh() {
    try {
      setTags(await listAdminTags());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load tags");
    }
  }

  useEffect(() => {
    let cancelled = false;
    listAdminTags()
      .then((next) => {
        if (cancelled) return;
        setTags(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load tags");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function fail(err: unknown, fallback: string) {
    setError(err instanceof ApiError ? `${err.message} (${err.code})` : fallback);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const tag = await createAdminTag({ slug: newSlug.trim(), label: newLabel.trim() });
      setMessage(`Created “${tag.label}”.`);
      setNewSlug("");
      setNewLabel("");
      await refresh();
    } catch (err) {
      fail(err, "Could not create tag");
    } finally {
      setBusy(false);
    }
  }

  async function rename(tag: AdminTag, fields: { slug: string; label: string }) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await updateAdminTag(tag.id, {
        slug: fields.slug,
        label: fields.label,
        password: password || undefined,
      });
      setMessage(`Renamed to “${fields.label}”.`);
      await refresh();
    } catch (err) {
      fail(err, "Rename failed");
    } finally {
      setBusy(false);
    }
  }

  async function blacklist(tag: AdminTag) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await updateAdminTag(tag.id, {
        blacklisted: true,
        password: password || undefined,
      });
      setMessage(`Blacklisted “${tag.label}” — detached from ${result.detached} preset(s).`);
      await refresh();
    } catch (err) {
      fail(err, "Blacklist failed");
    } finally {
      setBusy(false);
    }
  }

  async function merge(e: React.FormEvent) {
    e.preventDefault();
    if (!merging) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await mergeAdminTags(merging.id, {
        targetTagId: mergeTarget,
        password: password || undefined,
      });
      setMessage(
        `Merged “${result.merged.sourceSlug}” into “${result.merged.targetSlug}” (${result.merged.moved} moved).`,
      );
      setMerging(null);
      setMergeTarget("");
      await refresh();
    } catch (err) {
      fail(err, "Merge failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New tag</h2>
          <form onSubmit={create} className="mt-4 space-y-3">
            <Field label="Slug" htmlFor="tag-slug" hint="lowercase letters, digits and dashes">
              <input
                id="tag-slug"
                className={inputClass}
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                required
              />
            </Field>
            <Field label="Label" htmlFor="tag-label">
              <input
                id="tag-label"
                className={inputClass}
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                required
              />
            </Field>
            <Button busy={busy}>Create tag</Button>
          </form>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Confirm password
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Required for blacklisting and merging if your step-up window has lapsed.
          </p>
          <input
            className={`${inputClass} mt-3`}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            aria-label="Confirm password"
          />
        </section>
      </div>

      {error ? <ErrorBox title={error} /> : null}
      {message ? <SuccessBox>{message}</SuccessBox> : null}

      {merging ? (
        <form
          onSubmit={merge}
          className="rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-950"
        >
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Merge <span className="font-medium">{merging.label}</span> into:
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <select
              className={inputClass}
              value={mergeTarget}
              onChange={(e) => setMergeTarget(e.target.value)}
              required
              aria-label="Target tag"
            >
              <option value="">Choose target…</option>
              {tags
                .filter((t) => t.id !== merging.id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
            </select>
            <Button busy={busy}>Confirm merge</Button>
            <Button type="button" variant="secondary" onClick={() => setMerging(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <p className="text-sm text-zinc-500" aria-busy="true">
          Loading tags…
        </p>
      ) : (
        <ul className="space-y-2">
          {tags.map((tag) => (
            <TagRow
              key={tag.id}
              tag={tag}
              busy={busy}
              onRename={rename}
              onBlacklist={blacklist}
              onMerge={() => {
                setMerging(tag);
                setMergeTarget("");
              }}
            />
          ))}
          {tags.length === 0 ? <li className="text-sm text-zinc-500">No tags yet.</li> : null}
        </ul>
      )}
    </div>
  );
}

function TagRow({
  tag,
  busy,
  onRename,
  onBlacklist,
  onMerge,
}: {
  tag: AdminTag;
  busy: boolean;
  onRename: (tag: AdminTag, fields: { slug: string; label: string }) => void;
  onBlacklist: (tag: AdminTag) => void;
  onMerge: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [slug, setSlug] = useState(tag.slug);
  const [label, setLabel] = useState(tag.label);

  return (
    <li className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      {editing ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Slug" htmlFor={`slug-${tag.id}`}>
            <input
              id={`slug-${tag.id}`}
              className={inputClass}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </Field>
          <Field label="Label" htmlFor={`label-${tag.id}`}>
            <input
              id={`label-${tag.id}`}
              className={inputClass}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Button
            busy={busy}
            onClick={() => {
              onRename(tag, { slug, label });
              setEditing(false);
            }}
          >
            Save
          </Button>
          <Button variant="secondary" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium text-zinc-900 dark:text-zinc-100">
              {tag.label}{" "}
              {tag.blacklisted ? (
                <span className="ml-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
                  blacklisted
                </span>
              ) : null}
            </p>
            <p className="text-xs text-zinc-500">
              {tag.slug} · {tag.presetCount} preset{tag.presetCount === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Rename
            </Button>
            <Button variant="secondary" onClick={onMerge}>
              Merge
            </Button>
            {tag.blacklisted ? null : (
              <Button variant="danger" onClick={() => onBlacklist(tag)} busy={busy}>
                Blacklist
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export default function AdminTagsPage() {
  return (
    <AdminGate title="Tag governance">
      <TagsPanel />
    </AdminGate>
  );
}
