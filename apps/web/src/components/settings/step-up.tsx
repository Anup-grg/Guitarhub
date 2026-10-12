"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { Button, ErrorBox, Field, inputClass } from "@/components/ui";

export function StepUpPrompt({
  onConfirm,
  onCancel,
}: {
  onConfirm: (password: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        const ok = await onConfirm(password);
        if (!ok) {
          setBusy(false);
          setError("That password was incorrect — try again.");
        }
      }}
    >
      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
        Confirm it&apos;s you: re-enter your password to continue.
      </p>
      {error ? <ErrorBox title={error} /> : null}
      <Field label="Password" htmlFor="step-up-password">
        <input
          id="step-up-password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>
      <div className="flex gap-3">
        <Button busy={busy}>Confirm</Button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function isStepUpError(err: unknown): boolean {
  return err instanceof ApiError && err.code === "STEP_UP_REQUIRED";
}
