"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiError, votePreset, type VoteValue } from "@/lib/api";

type Props = {
  presetId: string;
  score: number;
  up: number;
  down: number;
  userVote: number;
  mine: boolean;
  signedIn: boolean;
};

export default function PresetVote({ presetId, score, up, down, userVote, mine, signedIn }: Props) {
  const [state, setState] = useState({ score, up, down, userVote });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cast(value: VoteValue) {
    if (mine || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next: VoteValue = value === state.userVote ? 0 : value;
      const res = await votePreset(presetId, next);
      setState({
        score: res.counts.score,
        up: res.counts.up,
        down: res.counts.down,
        userVote: res.userVote,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Sign in to vote on presets.");
      } else {
        setError(err instanceof ApiError ? err.message : "Could not save your vote.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1" data-testid="preset-vote">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Upvote"
          aria-pressed={state.userVote === 1}
          disabled={busy || mine}
          onClick={() => void cast(1)}
          className={`rounded-md border px-2.5 py-1 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
            state.userVote === 1
              ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
          }`}
        >
          ▲
        </button>
        <span
          className="min-w-8 text-center text-sm font-semibold text-zinc-900 dark:text-zinc-50"
          data-testid="vote-score"
        >
          {state.score}
        </span>
        <button
          type="button"
          aria-label="Downvote"
          aria-pressed={state.userVote === -1}
          disabled={busy || mine}
          onClick={() => void cast(-1)}
          className={`rounded-md border px-2.5 py-1 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
            state.userVote === -1
              ? "border-red-500 bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
              : "border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
          }`}
        >
          ▼
        </button>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {state.up} up · {state.down} down
        </span>
      </div>

      {mine ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          You can’t vote on your own preset.
        </p>
      ) : null}

      {!signedIn && !mine ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          <Link href="/login" className="underline hover:text-zinc-800 dark:hover:text-zinc-200">
            Sign in
          </Link>{" "}
          to vote.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
