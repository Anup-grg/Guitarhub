"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ApiError,
  deleteComment,
  listComments,
  postComment,
  reportContent,
  updateComment,
  type Comment,
} from "@/lib/api";
import { Button, ErrorBox, inputClass } from "@/components/ui";

const MAX_LENGTH = 2000;

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "Sign in to join the discussion.";
    return err.message;
  }
  return fallback;
}

export default function PresetComments({
  presetId,
  signedIn,
  currentUserId,
}: {
  presetId: string;
  signedIn: boolean;
  currentUserId: string | null;
}) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listComments(presetId, { limit: 20 })
      .then((res) => {
        if (!cancelled) {
          setComments(res.comments);
          setTotal(res.total);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err, "Could not load comments."));
      });
    return () => {
      cancelled = true;
    };
  }, [presetId]);

  function addTopLevel(comment: Comment) {
    setComments((prev) => [comment, ...(prev ?? [])]);
    setTotal((t) => t + 1);
  }

  return (
    <section className="mt-8" data-testid="preset-comments">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Comments {comments ? `(${total})` : ""}
      </h2>

      <div className="mt-3">
        {signedIn ? (
          <CommentComposer presetId={presetId} onPosted={addTopLevel} />
        ) : (
          <p className="rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            <Link href="/login" className="underline hover:text-zinc-800 dark:hover:text-zinc-200">
              Sign in
            </Link>{" "}
            to leave a comment.
          </p>
        )}
      </div>

      {error ? (
        <div className="mt-4">
          <ErrorBox title={error} />
        </div>
      ) : null}

      {comments === null && !error ? (
        <p className="mt-4 text-sm text-zinc-500" aria-busy="true">
          Loading comments…
        </p>
      ) : null}

      {comments && comments.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400" data-testid="comments-empty">
          No comments yet — start the conversation.
        </p>
      ) : null}

      {comments && comments.length > 0 ? (
        <ul className="mt-4 space-y-5">
          {comments.map((comment) => (
            <CommentThread
              key={comment.id}
              comment={comment}
              presetId={presetId}
              signedIn={signedIn}
              currentUserId={currentUserId}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function CommentThread({
  comment,
  presetId,
  signedIn,
  currentUserId,
}: {
  comment: Comment;
  presetId: string;
  signedIn: boolean;
  currentUserId: string | null;
}) {
  const [replies, setReplies] = useState<Comment[]>(comment.replies);
  return (
    <li>
      <CommentItem
        comment={comment}
        presetId={presetId}
        signedIn={signedIn}
        currentUserId={currentUserId}
        allowReply
        onReplied={(reply) => setReplies((prev) => [...prev, reply])}
      />
      {replies.length > 0 ? (
        <ul className="mt-3 space-y-4 border-l border-zinc-200 pl-4 dark:border-zinc-800">
          {replies.map((reply) => (
            <li key={reply.id}>
              <CommentItem
                comment={reply}
                presetId={presetId}
                signedIn={signedIn}
                currentUserId={currentUserId}
                allowReply={false}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function CommentItem({
  comment,
  presetId,
  signedIn,
  currentUserId,
  allowReply,
  onReplied,
}: {
  comment: Comment;
  presetId: string;
  signedIn: boolean;
  currentUserId: string | null;
  allowReply: boolean;
  onReplied?: (reply: Comment) => void;
}) {
  const [body, setBody] = useState(comment);
  const [mode, setMode] = useState<"idle" | "reply" | "edit" | "report">("idle");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reported, setReported] = useState(false);

  const mine = currentUserId !== null && body.author?.id === currentUserId;

  function close() {
    setMode("idle");
    setDraft("");
    setError(null);
  }

  async function submitReply() {
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await postComment(presetId, draft.trim(), body.id);
      onReplied?.(created);
      close();
    } catch (err) {
      setError(errorMessage(err, "Could not post your reply."));
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit() {
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateComment(body.id, draft.trim());
      setBody(updated);
      close();
    } catch (err) {
      setError(errorMessage(err, "Could not save your edit."));
    } finally {
      setBusy(false);
    }
  }

  async function submitReport() {
    if (draft.trim().length < 10) {
      setError("Please describe the problem (at least 10 characters).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reportContent({ targetType: "comment", targetId: body.id, reason: draft.trim() });
      setReported(true);
      close();
    } catch (err) {
      setError(errorMessage(err, "Could not submit your report."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteComment(body.id);
      setBody({ ...body, deleted: true, bodyMd: null, bodyHtml: null, author: null });
      close();
    } catch (err) {
      setError(errorMessage(err, "Could not delete the comment."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="text-sm" data-testid="comment">
      {body.deleted ? (
        <p className="text-xs italic text-zinc-400 dark:text-zinc-600">[comment deleted]</p>
      ) : (
        <>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {body.author?.displayName}
            </span>
            {body.author?.verified ? " (verified)" : ""} · {formatDate(body.createdAt)}
            {body.editedAt ? " · edited" : ""}
          </p>
          <div
            className="mt-1 space-y-1 text-zinc-700 dark:text-zinc-300 [&_a]:underline [&_code]:rounded [&_code]:bg-zinc-100 [&_code]:px-1 [&_code]:text-xs dark:[&_code]:bg-zinc-900 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-zinc-100 [&_pre]:p-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-zinc-500"
            dangerouslySetInnerHTML={{ __html: body.bodyHtml ?? "" }}
          />
        </>
      )}

      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {!body.deleted && mode === "idle" ? (
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          {signedIn && allowReply ? (
            <button
              type="button"
              className="hover:text-zinc-800 dark:hover:text-zinc-200"
              onClick={() => setMode("reply")}
            >
              Reply
            </button>
          ) : null}
          {signedIn && mine ? (
            <button
              type="button"
              className="hover:text-zinc-800 dark:hover:text-zinc-200"
              onClick={() => {
                setDraft(body.bodyMd ?? "");
                setMode("edit");
              }}
            >
              Edit
            </button>
          ) : null}
          {signedIn && mine ? (
            <button
              type="button"
              className="hover:text-red-600 dark:hover:text-red-400"
              disabled={busy}
              onClick={() => void remove()}
            >
              Delete
            </button>
          ) : null}
          {signedIn && !mine ? (
            reported ? (
              <span>Reported</span>
            ) : (
              <button
                type="button"
                className="hover:text-zinc-800 dark:hover:text-zinc-200"
                onClick={() => setMode("report")}
              >
                Report
              </button>
            )
          ) : null}
        </div>
      ) : null}

      {mode === "reply" || mode === "edit" || mode === "report" ? (
        <div className="mt-2 space-y-2">
          <textarea
            aria-label={
              mode === "reply"
                ? "Write a reply"
                : mode === "edit"
                  ? "Edit comment"
                  : "Report reason"
            }
            className={`${inputClass} min-h-20`}
            maxLength={mode === "report" ? 1000 : MAX_LENGTH}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              busy={busy}
              onClick={() => {
                if (mode === "reply") void submitReply();
                else if (mode === "edit") void submitEdit();
                else void submitReport();
              }}
            >
              {mode === "reply" ? "Post reply" : mode === "edit" ? "Save" : "Submit report"}
            </Button>
            <button
              type="button"
              className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              onClick={close}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function CommentComposer({
  presetId,
  onPosted,
}: {
  presetId: string;
  onPosted: (comment: Comment) => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await postComment(presetId, draft.trim());
      onPosted(created);
      setDraft("");
    } catch (err) {
      setError(errorMessage(err, "Could not post your comment."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        aria-label="Write a comment"
        className={`${inputClass} min-h-24`}
        maxLength={MAX_LENGTH}
        placeholder="Share tone tips, settings, or feedback… Markdown is supported."
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" busy={busy} disabled={!draft.trim()}>
          Comment
        </Button>
        <span className="text-xs text-zinc-400 dark:text-zinc-600">
          {draft.length}/{MAX_LENGTH}
        </span>
      </div>
      <ErrorBox title={error} />
    </form>
  );
}
