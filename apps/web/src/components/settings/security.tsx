"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type IdentityInfo, type SelfUser } from "@/lib/api";
import { attempt } from "@/lib/step-up";
import { Button, ErrorBox, Field, inputClass, SuccessBox } from "@/components/ui";
import { StepUpPrompt } from "./step-up";

type Setup = { secret: string; uri: string };

export function SecuritySection({ user, onChange }: { user: SelfUser; onChange: (u: SelfUser) => void }) {
  const [identities, setIdentities] = useState<IdentityInfo[] | null>(null);

  useEffect(() => {
    api<{ identities: IdentityInfo[] }>("/me/identities")
      .then((data) => setIdentities(data.identities))
      .catch(() => setIdentities([]));
  }, []);

  return (
    <section className="space-y-8">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Security</h2>
      <PasswordChange />
      <TwoFactor user={user} onChange={onChange} />
      <ConnectedAccounts identities={identities} onChanged={(next) => setIdentities(next)} />
    </section>
  );
}

function PasswordChange() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (next !== confirm) {
      setError("The two new passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await api("/auth/password/change", {
        method: "POST",
        body: { currentPassword: current, newPassword: next },
      });
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong — please try again.");
    }
    setBusy(false);
  }

  return (
    <div className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Password
      </h3>
      <form className="mt-3 max-w-md space-y-4" onSubmit={submit}>
        {done ? <SuccessBox>Password updated. Other devices were signed out.</SuccessBox> : null}
        {error ? <ErrorBox title={error} /> : null}
        <Field label="Current password" htmlFor="current-password">
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            required
            className={inputClass}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field label="New password" htmlFor="new-password" hint="At least 10 characters.">
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            className={inputClass}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm-password">
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            className={inputClass}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        <Button busy={busy}>Change password</Button>
      </form>
    </div>
  );
}

function TwoFactor({ user, onChange }: { user: SelfUser; onChange: (u: SelfUser) => void }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepUp, setStepUp] = useState(false);

  useEffect(() => {
    if (!setup) return;
    let cancelled = false;
    import("qrcode")
      .then((m) => m.default.toDataURL(setup.uri, { margin: 1, width: 240 }))
      .then((url) => {
        if (!cancelled) setQr(url);
      })
      .catch(() => setQr(null));
    return () => {
      cancelled = true;
    };
  }, [setup]);

  async function startSetup() {
    setBusy(true);
    setError(null);
    try {
      const data = await api<Setup>("/auth/2fa/setup", { method: "POST" });
      setSetup(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong — please try again.");
    }
    setBusy(false);
  }

  async function confirmSetup(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ recoveryCodes: string[] }>("/auth/2fa/verify", {
        method: "POST",
        body: { code },
      });
      setRecoveryCodes(data.recoveryCodes);
      setSetup(null);
      setCode("");
      onChange({ ...user, totpEnabled: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong — please try again.");
    }
    setBusy(false);
  }

  async function disable(password?: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    const result = await attempt(async () => {
      await api("/auth/2fa/disable", {
        method: "POST",
        body: password ? { password } : {},
      });
    });
    setBusy(false);
    if (result.ok) {
      setStepUp(false);
      onChange({ ...user, totpEnabled: false });
      return true;
    }
    if (result.stepUp) {
      setStepUp(true);
      return false;
    }
    setError(result.error);
    return false;
  }

  if (recoveryCodes) {
    return (
      <div className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Recovery codes
        </h3>
        <SuccessBox>
          Two-factor authentication is on. Save these codes somewhere safe — each one works once
          if you lose your authenticator. They will not be shown again.
        </SuccessBox>
        <div className="grid max-w-md grid-cols-2 gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
          {recoveryCodes.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <div className="flex gap-3">
          <Button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(recoveryCodes.join("\n"));
            }}
          >
            Copy codes
          </Button>
          <Button type="button" variant="secondary" onClick={() => setRecoveryCodes(null)}>
            I&apos;ve saved them
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Two-factor authentication
      </h3>
      {error ? <ErrorBox title={error} /> : null}

      {setup ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password…),
            then enter the 6-digit code it shows.
          </p>
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="Two-factor authentication QR code" width={240} height={240} />
          ) : (
            <p className="text-sm text-zinc-500">Loading QR code…</p>
          )}
          <p className="rounded-md bg-zinc-100 px-3 py-2 font-mono text-xs text-zinc-700 break-all dark:bg-zinc-900 dark:text-zinc-300">
            {setup.secret}
          </p>
          <form className="flex max-w-xs gap-2" onSubmit={confirmSetup}>
            <input
              aria-label="Two-factor code"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={8}
              placeholder="123456"
              required
              className={inputClass}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button busy={busy}>Turn on</Button>
          </form>
          <button
            type="button"
            className="text-sm font-medium text-zinc-600 underline dark:text-zinc-400"
            onClick={() => {
              setSetup(null);
              setQr(null);
            }}
          >
            Cancel
          </button>
        </div>
      ) : user.totpEnabled ? (
        <div className="space-y-3">
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            Two-factor authentication is on.
          </p>
          {stepUp ? (
            <StepUpPrompt onConfirm={async (password) => disable(password)} onCancel={() => setStepUp(false)} />
          ) : (
            <Button
              type="button"
              variant="secondary"
              busy={busy}
              onClick={() => void disable()}
            >
              Turn off two-factor authentication
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Add a second step at sign-in: a rotating 6-digit code from your phone.
          </p>
          <Button type="button" busy={busy} onClick={startSetup}>
            Set up two-factor authentication
          </Button>
        </div>
      )}
    </div>
  );
}

function ConnectedAccounts({
  identities,
  onChanged,
}: {
  identities: IdentityInfo[] | null;
  onChanged: (next: IdentityInfo[]) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function unlink(provider: string) {
    setError(null);
    try {
      await api(`/me/identities/${provider}`, { method: "DELETE" });
      onChanged((identities ?? []).filter((i) => i.provider !== provider));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not unlink that account.");
    }
  }

  const linked = new Set((identities ?? []).map((i) => i.provider));

  return (
    <div className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Connected accounts
      </h3>
      {error ? <ErrorBox title={error} /> : null}
      <ul className="max-w-md space-y-2">
        {["google", "github"].map((provider) => (
          <li
            key={provider}
            className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
          >
            <span className="capitalize text-zinc-700 dark:text-zinc-300">{provider}</span>
            {identities === null ? (
              <span className="text-zinc-400">…</span>
            ) : linked.has(provider) ? (
              <button
                type="button"
                className="font-medium text-red-600 hover:text-red-500 dark:text-red-400"
                onClick={() => void unlink(provider)}
              >
                Unlink
              </button>
            ) : (
              <form method="POST" action={`/api/v1/auth/oauth/${provider}/link`}>
                <button
                  type="submit"
                  className="font-medium text-zinc-900 underline hover:text-zinc-700 dark:text-zinc-100"
                >
                  Link
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Linking keeps your password sign-in working alongside the provider.
      </p>
    </div>
  );
}
