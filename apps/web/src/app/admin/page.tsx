"use client";

import { useEffect, useState } from "react";
import AdminGate from "@/components/admin-gate";
import { ErrorBox } from "@/components/ui";
import { ApiError, getAdminStats, type AdminStats } from "@/lib/api";

type State =
  | { status: "loading" }
  | { status: "error"; message: string; issues: string[] }
  | { status: "ready"; stats: AdminStats };

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function Card({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{value}</p>
      {sub ? <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{sub}</p> : null}
    </div>
  );
}

function StatsPanel() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    getAdminStats()
      .then((stats) => {
        if (!cancelled) setState({ status: "ready", stats });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof ApiError ? err.message : "Something went wrong";
        const issues = err instanceof ApiError ? err.issues.map((i) => i.message) : [];
        setState({ status: "error", message, issues });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <p className="text-sm text-zinc-500" aria-busy="true">
        Loading stats…
      </p>
    );
  }
  if (state.status === "error") {
    return <ErrorBox title={state.message} issues={state.issues} />;
  }

  const { stats } = state;
  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card
          label="Users"
          value={stats.users.total}
          sub={`${stats.users.verified} verified · ${stats.users.last30Days} new in 30d`}
        />
        <Card
          label="Presets"
          value={stats.presets.total}
          sub={`${stats.presets.published} published · ${stats.presets.hidden} hidden`}
        />
        <Card label="Downloads" value={stats.downloads.total} sub={`${stats.downloads.events} tracked`} />
        <Card label="Storage" value={formatBytes(stats.storage.bytes)} sub={`${stats.storage.files} files`} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card label="Comments" value={stats.engagement.comments} />
        <Card label="Votes" value={stats.engagement.votes} />
        <Card label="Open reports" value={stats.engagement.openReports} />
      </div>

      <section>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Downloads per pedal</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">Pedal</th>
                <th className="px-4 py-2 font-medium">Published</th>
                <th className="px-4 py-2 font-medium">Downloads</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {stats.perPedal.map((row) => (
                <tr key={row.pedalId}>
                  <td className="px-4 py-2 text-zinc-900 dark:text-zinc-100">
                    {row.brand} {row.model}
                  </td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{row.presets}</td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{row.downloads}</td>
                </tr>
              ))}
              {stats.perPedal.length === 0 ? (
                <tr>
                  <td className="px-4 py-3 text-zinc-500" colSpan={3}>
                    No pedals yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Recent signups</h2>
        <ul className="mt-3 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
          {stats.recentSignups.map((u) => (
            <li key={u.id}>
              {u.displayName} — {new Date(u.createdAt).toLocaleDateString()}
            </li>
          ))}
          {stats.recentSignups.length === 0 ? <li>No signups yet.</li> : null}
        </ul>
      </section>
    </div>
  );
}

export default function AdminOverviewPage() {
  return (
    <AdminGate title="Admin overview">
      <StatsPanel />
    </AdminGate>
  );
}
