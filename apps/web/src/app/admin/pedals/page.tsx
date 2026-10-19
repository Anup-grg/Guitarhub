"use client";

import { useEffect, useState } from "react";
import AdminGate from "@/components/admin-gate";
import { Button, ErrorBox, Field, inputClass, SuccessBox } from "@/components/ui";
import {
  ApiError,
  createAdminPedal,
  listAdminPedals,
  updateAdminPedal,
  type AdminPedal,
} from "@/lib/api";

const VALIDATION_MODES = ["DEEP_JSON", "SYSEX", "FIXED_BINARY", "SHALLOW", "CLOUD_LINK"];

function PedalsPanel() {
  const [pedals, setPedals] = useState<AdminPedal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [validationMode, setValidationMode] = useState("DEEP_JSON");
  const [extensions, setExtensions] = useState("");

  async function refresh() {
    try {
      setPedals(await listAdminPedals());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load pedals");
    }
  }

  useEffect(() => {
    let cancelled = false;
    listAdminPedals()
      .then((next) => {
        if (cancelled) return;
        setPedals(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load pedals");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const pedal = await createAdminPedal({
        brand: brand.trim(),
        model: model.trim(),
        validationMode,
        extensions: extensions
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => (x.startsWith(".") ? x : `.${x}`)),
      });
      setMessage(`Created ${pedal.brand} ${pedal.model}.`);
      setBrand("");
      setModel("");
      setExtensions("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.message} (${err.code})` : "Could not create pedal");
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(pedal: AdminPedal) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await updateAdminPedal(pedal.id, { enabled: !pedal.enabled });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(
    pedal: AdminPedal,
    fields: { brand: string; model: string; validationMode: string },
  ) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await updateAdminPedal(pedal.id, fields);
      setEditing(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.message} (${err.code})` : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Add a pedal</h2>
        <form onSubmit={create} className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Brand" htmlFor="brand">
            <input
              id="brand"
              className={inputClass}
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              required
            />
          </Field>
          <Field label="Model" htmlFor="model">
            <input
              id="model"
              className={inputClass}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              required
            />
          </Field>
          <Field label="Validation mode" htmlFor="mode">
            <select
              id="mode"
              className={inputClass}
              value={validationMode}
              onChange={(e) => setValidationMode(e.target.value)}
            >
              {VALIDATION_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Extensions" htmlFor="ext" hint="Comma-separated, e.g. .hlx, .hls">
            <input
              id="ext"
              className={inputClass}
              value={extensions}
              onChange={(e) => setExtensions(e.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Button busy={busy}>Create pedal</Button>
          </div>
        </form>
      </section>

      {error ? <ErrorBox title={error} /> : null}
      {message ? <SuccessBox>{message}</SuccessBox> : null}

      {loading ? (
        <p className="text-sm text-zinc-500" aria-busy="true">
          Loading catalog…
        </p>
      ) : (
        <ul className="space-y-3">
          {pedals.map((pedal) => (
            <li
              key={pedal.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
            >
              {editing === pedal.id ? (
                <EditRow
                  pedal={pedal}
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onSave={saveEdit}
                />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">
                      {pedal.brand} {pedal.model}{" "}
                      {pedal.enabled ? null : (
                        <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                          disabled
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {pedal.slug} · {pedal.validationMode} · {pedal.presetCount} published
                      {pedal.extensions.length ? ` · ${pedal.extensions.join(" ")}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setEditing(pedal.id)}>
                      Edit
                    </Button>
                    <Button variant="secondary" onClick={() => toggleEnabled(pedal)} busy={busy}>
                      {pedal.enabled ? "Disable" : "Enable"}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
          {pedals.length === 0 ? <li className="text-sm text-zinc-500">No pedals yet.</li> : null}
        </ul>
      )}
    </div>
  );
}

function EditRow({
  pedal,
  busy,
  onCancel,
  onSave,
}: {
  pedal: AdminPedal;
  busy: boolean;
  onCancel: () => void;
  onSave: (
    pedal: AdminPedal,
    fields: { brand: string; model: string; validationMode: string },
  ) => void;
}) {
  const [brand, setBrand] = useState(pedal.brand);
  const [model, setModel] = useState(pedal.model);
  const [validationMode, setValidationMode] = useState(pedal.validationMode);
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Brand" htmlFor={`brand-${pedal.id}`}>
        <input
          id={`brand-${pedal.id}`}
          className={inputClass}
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
        />
      </Field>
      <Field label="Model" htmlFor={`model-${pedal.id}`}>
        <input
          id={`model-${pedal.id}`}
          className={inputClass}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
      </Field>
      <Field label="Validation mode" htmlFor={`mode-${pedal.id}`}>
        <select
          id={`mode-${pedal.id}`}
          className={inputClass}
          value={validationMode}
          onChange={(e) => setValidationMode(e.target.value)}
        >
          {VALIDATION_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex gap-2 sm:col-span-3">
        <Button onClick={() => onSave(pedal, { brand, model, validationMode })} busy={busy}>
          Save
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function AdminPedalsPage() {
  return (
    <AdminGate title="Pedal catalog">
      <PedalsPanel />
    </AdminGate>
  );
}
