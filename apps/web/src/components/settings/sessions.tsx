"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type SessionInfo } from "@/lib/api";
import { Button, ErrorBox, SuccessBox } from "@/components/ui";

export function SessionsSection({ onSignedOutAll }: { onSignedOutAll: () => void }) {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    const data = await api<{ sessions: SessionInfo[] }>("/me/sessions");
    return data.sessions;
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchSessions()
      .then((rows) => {
        if (!cancelled) setSessions(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load your sessions.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetchSessions]);

  async function revoke(id: string) {
    setError(null);
    setNotice(null);
    try {
      await api(`/me/sessions/${id}`, { method: "DELETE" });
      setSessions(await fetchSessions());
      setNotice("Session signed out.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign that session out.");
    }
  }

  async function revokeAll() {
    setError(null);
    setNotice(null);
    try {
      await api("/me/sessions", { method: "DELETE" });
      onSignedOutAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Sessions</h2>
      {error ? <ErrorBox title={error} /> : null}
      {notice ? <SuccessBox>{notice}</SuccessBox> : null}
      {sessions === null && !error ? (
        <p className="text-sm text-zinc-500">Loading sessions…</p>
      ) : (
        <>
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
            {(sessions ?? []).map((session) => (
              <li key={session.id} className="flex items-center gap-4 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-zinc-800 dark:text-zinc-200">
                    {session.deviceName ?? "Unknown device"}
                    {session.current ? (
                      <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                        this device
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {session.ip ?? "unknown IP"} · signed in{" "}
                    {new Date(session.createdAt).toLocaleDateString()}
                  </p>
                </div>
                {!session.current ? (
                  <button
                    type="button"
                    className="font-medium text-red-600 hover:text-red-500 dark:text-red-400"
                    onClick={() => void revoke(session.id)}
                  >
                    Sign out
                  </button>
                ) : null}
              </li>
            ))}
            {(sessions ?? []).length === 0 ? (
              <li className="px-4 py-3 text-sm text-zinc-500">No active sessions.</li>
            ) : null}
          </ul>
          <Button type="button" variant="secondary" onClick={() => void revokeAll()}>
            Sign out everywhere
          </Button>
        </>
      )}
    </section>
  );
}
