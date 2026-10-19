import { MARKDOWN_VERSION, renderMarkdown } from "./markdown.js";

/** FR-4.4 — edits are allowed for 15 minutes after posting. */
export const COMMENT_EDIT_WINDOW_MS = 15 * 60 * 1000;
/** NFR-6 — minimum account age before the first comment. */
export const COMMENT_MIN_ACCOUNT_AGE_MS = 10 * 60 * 1000;
/** NFR-6 — "link limits in comments". */
export const MAX_COMMENT_LINKS = 4;
export const MAX_COMMENT_LENGTH = 2000;

export type CommentRow = {
  id: string;
  presetId: string;
  userId: string;
  parentId: string | null;
  bodyMd: string;
  bodyHtml: string;
  bodyHtmlVersion: number;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
};

export type CommentAuthor = { id: string; displayName: string; verified: boolean };

export type SerializedComment = {
  id: string;
  parentId: string | null;
  bodyMd: string | null;
  bodyHtml: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deleted: boolean;
  author: CommentAuthor | null;
  replies: SerializedComment[];
};

/**
 * Renders the stored HTML when its sanitizer version matches, otherwise
 * re-renders from Markdown (FR-4.4 defense-in-depth on read).
 */
export function commentHtml(
  row: Pick<CommentRow, "bodyMd" | "bodyHtml" | "bodyHtmlVersion">,
): string {
  if (row.bodyHtmlVersion === MARKDOWN_VERSION) return row.bodyHtml;
  return renderMarkdown(row.bodyMd).html;
}

export function serializeComment(
  row: CommentRow,
  author: CommentAuthor | null,
  replies: SerializedComment[] = [],
): SerializedComment {
  const deleted = Boolean(row.deletedAt);
  return {
    id: row.id,
    parentId: row.parentId ?? null,
    bodyMd: deleted ? null : row.bodyMd,
    bodyHtml: deleted ? null : commentHtml(row),
    createdAt: row.createdAt,
    editedAt: row.editedAt ?? null,
    deleted,
    author: deleted ? null : author,
    replies,
  };
}
