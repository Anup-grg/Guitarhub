"use client";

import { useEffect, useState } from "react";
import AdminGate from "@/components/admin-gate";
import { Button, ErrorBox, Field, inputClass, SuccessBox } from "@/components/ui";
import {
  ApiError,
  banUser,
  listAdminReports,
  resolveAdminReport,
  type AdminReport,
  type AdminReportList,
  type ReportTarget,
} from "@/lib/api";

type Status = "open" | "resolved" | "dismissed";

const STATUS_TABS: Status[] = ["open", "resolved", "dismissed"];

function TargetSummary({ target }: { target: ReportTarget }) {
  if (target.missing) {
    return <p className="text-sm text-zinc-500">Content no longer exists.</p>;
  }
  if (target.type === "preset") {
    return (
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        Preset <span className="font-medium">{target.title}</span>{" "}
        <span className="text-xs uppercase text-zinc-500">({target.status})</span>
        {target.owner ? <span className="text-zinc-500"> by {target.owner.displayName}</span> : null}
      </p>
    );
  }
  return (
    <p className="text-sm text-zinc-700 dark:text-zinc-300">
      Comment {target.deleted ? <em>(deleted)</em> : null} on{" "}
      <span className="font-medium">{target.preset?.title ?? "a preset"}</span>
      {target.owner ? <span className="text-zinc-500"> by {target.owner.displayName}</span> : null}
      <span className="mt-0.5 block text-zinc-500">“{target.excerpt}”</span>
    </p>
  );
}

function ReportsPanel() {
  const [status, setStatus] = useState<Status>("open");
  const [data, setData] = useState<AdminReportList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [password, setPassword] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    try {
      const next = await listAdminReports({ status });
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load reports");
    }
  }

  useEffect(() => {
    let cancelled = false;
    listAdminReports({ status })
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load reports");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  async function run(report: AdminReport, action: "dismiss" | "hide" | "remove") {
    setBusyId(report.id);
    setError(null);
    setMessage(null);
    try {
      await resolveAdminReport(report.id, {
        action,
        note: note.trim() || undefined,
        password: password || undefined,
      });
      setMessage(`Report ${action}d.`);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.message} (${err.code})` : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  async function ban(report: AdminReport) {
    if (!report.target.owner) return;
    setBusyId(report.id);
    setError(null);
    setMessage(null);
    try {
      await banUser(report.target.owner.id, {
        type: "hard",
        reason: note.trim() || `Banned via report ${report.id}`,
        password: password || undefined,
      });
      setMessage(`Banned ${report.target.owner.displayName}.`);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.message} (${err.code})` : "Ban failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => {
              setLoading(true);
              setStatus(tab);
            }}
            aria-pressed={status === tab}
            className={`rounded-full px-3 py-1 text-sm font-medium capitalize ${
              status === tab
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
            }`}
          >
            {tab}
            {data ? ` (${data.counts[tab]})` : ""}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Moderator note" htmlFor="mod-note">
          <input
            id="mod-note"
            className={inputClass}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason shown to the reporter / in the audit log"
          />
        </Field>
        <Field label="Confirm password" hint="Required if your step-up window has lapsed." htmlFor="mod-password">
          <input
            id="mod-password"
            className={inputClass}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
      </div>

      {error ? <ErrorBox title={error} /> : null}
      {message ? <SuccessBox>{message}</SuccessBox> : null}

      {loading ? (
        <p className="text-sm text-zinc-500" aria-busy="true">
          Loading reports…
        </p>
      ) : null}

      {!loading && data && data.reports.length === 0 ? (
        <p className="text-sm text-zinc-500">No {status} reports.</p>
      ) : null}

      <ul className="space-y-4">
        {data?.reports.map((report) => (
          <li
            key={report.id}
            className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  {report.targetType} report · {report.status}
                </p>
                <div className="mt-1">
                  <TargetSummary target={report.target} />
                </div>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  Reason: {report.reason}
                </p>
                {report.reporter ? (
                  <p className="mt-1 text-xs text-zinc-500">Reported by {report.reporter.displayName}</p>
                ) : null}
              </div>
            </div>

            {report.status === "open" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => run(report, "dismiss")} busy={busyId === report.id}>
                  Dismiss
                </Button>
                <Button variant="secondary" onClick={() => run(report, "hide")} busy={busyId === report.id}>
                  Hide content
                </Button>
                <Button variant="danger" onClick={() => run(report, "remove")} busy={busyId === report.id}>
                  Remove content
                </Button>
                {report.target.owner ? (
                  <Button variant="danger" onClick={() => ban(report)} busy={busyId === report.id}>
                    Ban {report.target.owner.displayName}
                  </Button>
                ) : null}
              </div>
            ) : report.resolutionNote ? (
              <p className="mt-3 text-sm text-zinc-500">{report.resolutionNote}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AdminReportsPage() {
  return (
    <AdminGate title="Moderation queue">
      <ReportsPanel />
    </AdminGate>
  );
}
