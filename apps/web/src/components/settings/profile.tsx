"use client";

import { useEffect, useState } from "react";
import {
  api,
  getMyGear,
  listPedals,
  type GearItem,
  type PedalSummary,
  type ProfileLink,
  type SelfUser,
} from "@/lib/api";
import { attempt } from "@/lib/step-up";
import { Button, ErrorBox, Field, inputClass, SuccessBox } from "@/components/ui";
import { StepUpPrompt } from "./step-up";

export function ProfileSection({
  user,
  onChange,
}: {
  user: SelfUser;
  onChange: (user: SelfUser) => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? "");
  const [email, setEmail] = useState(user.email);
  const [links, setLinks] = useState<ProfileLink[]>(
    user.links.length > 0 ? user.links : [{ label: "", url: "" }],
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [stepUp, setStepUp] = useState(false);

  const [gear, setGear] = useState<GearItem[]>([]);
  const [pedals, setPedals] = useState<PedalSummary[]>([]);
  const [pick, setPick] = useState({ pedalId: "", firmwareVersion: "" });
  const [gearError, setGearError] = useState<string | null>(null);
  const [gearDirty, setGearDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getMyGear(), listPedals()])
      .then(([mine, catalog]) => {
        if (cancelled) return;
        if (mine.length > 0) setGear(mine);
        if (catalog.length > 0) setPedals(catalog);
      })
      .catch(() => {
        if (!cancelled) setGearError("Couldn't load your gear list.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function addGear() {
    const pedal = pedals.find((p) => p.id === pick.pedalId);
    if (!pedal) {
      setGearError("Pick a pedal from the catalog.");
      return;
    }
    if (gear.some((g) => g.pedalId === pedal.id)) {
      setGearError("That pedal is already in your gear list.");
      return;
    }
    setGear([
      ...gear,
      {
        pedalId: pedal.id,
        firmwareVersion: pick.firmwareVersion.trim() || null,
        pedal: { id: pedal.id, brand: pedal.brand, model: pedal.model, slug: pedal.slug },
      },
    ]);
    setPick({ pedalId: "", firmwareVersion: "" });
    setGearError(null);
    setGearDirty(true);
  }

  function removeGear(pedalId: string) {
    setGear(gear.filter((g) => g.pedalId !== pedalId));
    setGearDirty(true);
  }

  function setFirmware(pedalId: string, firmwareVersion: string) {
    setGear(
      gear.map((g) =>
        g.pedalId === pedalId ? { ...g, firmwareVersion: firmwareVersion.trim() || null } : g,
      ),
    );
    setGearDirty(true);
  }

  async function save(password?: string): Promise<boolean> {
    setBusy(true);
    setSaved(false);
    setError(null);
    setIssues([]);
    const cleanLinks = links.filter((l) => l.label.trim() && l.url.trim());
    const result = await attempt(async () => {
      const data = await api<{ user: SelfUser; gear: GearItem[] }>("/me", {
        method: "PATCH",
        body: {
          displayName,
          bio,
          avatarUrl: avatarUrl.trim() ? avatarUrl.trim() : null,
          email,
          links: cleanLinks,
          ...(gearDirty
            ? {
                gear: gear.map((g) => ({ pedalId: g.pedalId, firmwareVersion: g.firmwareVersion })),
              }
            : {}),
          ...(password ? { password } : {}),
        },
      });
      onChange(data.user);
      if (Array.isArray(data.gear)) setGear(data.gear);
      setGearDirty(false);
    });
    setBusy(false);

    if (result.ok) {
      setSaved(true);
      setStepUp(false);
      return true;
    }
    if (result.stepUp) {
      setStepUp(true);
      return false;
    }
    setError(result.error);
    return false;
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Profile</h2>
      {saved ? <SuccessBox>Profile saved.</SuccessBox> : null}
      {error ? <ErrorBox title={error} issues={issues} /> : null}
      {!user.emailVerified ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Your email isn&apos;t confirmed yet.{" "}
          <a href="/verify-email" className="font-medium underline">
            Resend the confirmation email
          </a>
          .
        </div>
      ) : null}
      {user.pendingEmail ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          A change to <span className="font-medium">{user.pendingEmail}</span> is waiting for
          confirmation.
        </p>
      ) : null}

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="Display name" htmlFor="displayName">
          <input
            id="displayName"
            required
            minLength={2}
            maxLength={40}
            className={inputClass}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </Field>

        <Field label="Email" htmlFor="email" hint="Changing this sends a confirmation link.">
          <input
            id="email"
            type="email"
            required
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field label="Bio" htmlFor="bio" hint="A sentence or two about the music you make.">
          <textarea
            id="bio"
            rows={3}
            maxLength={500}
            className={inputClass}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
        </Field>

        <Field label="Avatar URL" htmlFor="avatarUrl" hint="An https image URL.">
          <input
            id="avatarUrl"
            type="url"
            maxLength={500}
            className={inputClass}
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
          />
        </Field>

        <div className="space-y-2">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Links</p>
          {links.map((link, index) => (
            <div key={index} className="flex gap-2">
              <input
                aria-label={`Link ${index + 1} label`}
                placeholder="Label (e.g. YouTube)"
                maxLength={30}
                className={inputClass}
                value={link.label}
                onChange={(e) => {
                  const next = [...links];
                  next[index] = { ...next[index]!, label: e.target.value };
                  setLinks(next);
                }}
              />
              <input
                aria-label={`Link ${index + 1} URL`}
                placeholder="https://…"
                type="url"
                maxLength={500}
                className={inputClass}
                value={link.url}
                onChange={(e) => {
                  const next = [...links];
                  next[index] = { ...next[index]!, url: e.target.value };
                  setLinks(next);
                }}
              />
              <button
                type="button"
                aria-label={`Remove link ${index + 1}`}
                className="rounded-md border border-zinc-300 px-3 text-sm text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                onClick={() => setLinks(links.filter((_, i) => i !== index))}
              >
                ✕
              </button>
            </div>
          ))}
          {links.length < 6 ? (
            <button
              type="button"
              className="text-sm font-medium text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
              onClick={() => setLinks([...links, { label: "", url: "" }])}
            >
              Add link
            </button>
          ) : null}
        </div>

        <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Pedal gear</p>
            {gearDirty ? (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Unsaved changes</span>
            ) : null}
          </div>

          {gear.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {gear.map((item) => (
                <li
                  key={item.pedalId}
                  className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                >
                  <span className="shrink-0 text-sm text-zinc-800 dark:text-zinc-200">
                    {item.pedal.brand} {item.pedal.model}
                  </span>
                  <input
                    aria-label={`${item.pedal.brand} ${item.pedal.model} firmware version`}
                    placeholder="Firmware (e.g. 3.70)"
                    maxLength={40}
                    className={inputClass}
                    value={item.firmwareVersion ?? ""}
                    onChange={(e) => setFirmware(item.pedalId, e.target.value)}
                  />
                  <button
                    type="button"
                    aria-label={`Remove ${item.pedal.brand} ${item.pedal.model} from gear`}
                    className="shrink-0 rounded-md border border-zinc-300 px-3 text-sm text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                    onClick={() => removeGear(item.pedalId)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              {pedals.length === 0
                ? "No pedals in the catalog yet."
                : "Let everyone know which pedals you use."}
            </p>
          )}

          {pedals.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Field label="Add a pedal" htmlFor="gearPedal">
                <select
                  id="gearPedal"
                  className={inputClass}
                  value={pick.pedalId}
                  onChange={(e) => setPick({ ...pick, pedalId: e.target.value })}
                >
                  <option value="">Choose a pedal…</option>
                  {pedals.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.brand} {p.model}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Firmware version" htmlFor="gearFirmware">
                <input
                  id="gearFirmware"
                  placeholder="Optional"
                  maxLength={40}
                  className={inputClass}
                  value={pick.firmwareVersion}
                  onChange={(e) => setPick({ ...pick, firmwareVersion: e.target.value })}
                />
              </Field>
              <Button type="button" variant="secondary" disabled={!pick.pedalId} onClick={addGear}>
                Add to gear
              </Button>
            </div>
          ) : null}

          {gearError ? (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
              {gearError}
            </p>
          ) : null}
        </div>

        {stepUp ? (
          <StepUpPrompt
            onConfirm={async (password) => save(password)}
            onCancel={() => setStepUp(false)}
          />
        ) : (
          <Button busy={busy}>Save profile</Button>
        )}
      </form>
    </section>
  );
}
