"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { attempt } from "@/lib/step-up";
import { Button, ErrorBox, Field, inputClass } from "@/components/ui";
import { StepUpPrompt } from "./step-up";

export function DangerSection({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [presetAction, setPresetAction] = useState<"anonymize" | "remove">("anonymize");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepUp, setStepUp] = useState(false);

  async function remove(password?: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    const result = await attempt(async () => {
      await api("/me", {
        method: "DELETE",
        body: {
          confirm,
          presetAction,
          ...(password ? { password } : {}),
        },
      });
    });
    setBusy(false);
    if (result.ok) {
      onDeleted();
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
    <section className="space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">Delete account</h2>
      {error ? <ErrorBox title={error} /> : null}
      {!open ? (
        <Button type="button" variant="danger" onClick={() => setOpen(true)}>
          Delete my account
        </Button>
      ) : (
        <div className="max-w-md space-y-4 rounded-md border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
          <p className="text-sm text-red-900 dark:text-red-200">
            This immediately signs you out everywhere and deactivates your account. Your public
            profile is removed.
          </p>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-red-900 dark:text-red-200">
              What should happen to presets you&apos;ve uploaded?
            </legend>
            <label className="flex items-start gap-2 text-sm text-red-900 dark:text-red-200">
              <input
                type="radio"
                name="presetAction"
                value="anonymize"
                checked={presetAction === "anonymize"}
                onChange={() => setPresetAction("anonymize")}
              />
              <span>Keep them, attributed to &quot;Deleted user&quot;</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-red-900 dark:text-red-200">
              <input
                type="radio"
                name="presetAction"
                value="remove"
                checked={presetAction === "remove"}
                onChange={() => setPresetAction("remove")}
              />
              <span>Delete my presets too</span>
            </label>
          </fieldset>

          <Field label={'Type "DELETE" to confirm'} htmlFor="confirm-delete">
            <input
              id="confirm-delete"
              className={inputClass}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>

          {stepUp ? (
            <StepUpPrompt onConfirm={async (password) => remove(password)} onCancel={() => setStepUp(false)} />
          ) : (
            <div className="flex gap-3">
              <Button type="button" variant="danger" busy={busy} onClick={() => void remove()}>
                Permanently delete
              </Button>
              <button
                type="button"
                className="text-sm font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
                onClick={() => {
                  setOpen(false);
                  setConfirm("");
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
