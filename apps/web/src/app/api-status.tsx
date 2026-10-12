"use client";

import { useEffect, useState } from "react";

type Health = {
  status: string;
  service: string;
  db: string;
  time: string;
};

type State = "loading" | "ok" | "degraded" | "error";

const dotColor: Record<State, string> = {
  loading: "bg-amber-400",
  ok: "bg-emerald-500",
  degraded: "bg-amber-500",
  error: "bg-red-500",
};

const label: Record<State, string> = {
  loading: "checking…",
  ok: "ok",
  degraded: "degraded",
  error: "unreachable",
};

export default function ApiStatus() {
  const [state, setState] = useState<State>("loading");
  const [db, setDb] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/health")
      .then((res) => res.json())
      .then((data: Health) => {
        if (cancelled) return;
        setDb(data.db);
        setState(data.db === "up" ? "ok" : "degraded");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <span
      data-testid="api-status"
      className="inline-flex items-center gap-2 text-sm font-medium text-zinc-600 dark:text-zinc-400"
    >
      <span className={`h-2.5 w-2.5 rounded-full ${dotColor[state]}`} aria-hidden />
      API: {label[state]}
      {state !== "loading" && state !== "error" && db ? ` · db ${db}` : ""}
    </span>
  );
}
