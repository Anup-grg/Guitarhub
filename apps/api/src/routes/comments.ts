import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../errors/problem.js";
import { audit, clientIp } from "../lib/audit.js";
import { checkRate, rateLimited } from "../lib/rate-limit.js";
import { MARKDOWN_VERSION, renderMarkdown } from "../lib/markdown.js";
import {
  COMMENT_EDIT_WINDOW_MS,
  MAX_COMMENT_LENGTH,
  MAX_COMMENT_LINKS,
  serializeComment,
  type CommentRow,
} from "../lib/comments.js";
import { requireAuthed, requireUser } from "../middleware/auth.js";

const HOUR_MS = 60 * 60 * 1000;

export const commentsRouter = Router();

commentsRouter.use((req, res, next) => {
  requireUser(req, res, next);
});

function limit(key: string, max: number, message: string): void {
  const result = checkRate(key, { windowMs: HOUR_MS, max });
  if (!result.allowed) rateLimited(result, message);
}

const editSchema = z.object({ bodyMd: z.string().trim().min(1).max(MAX_COMMENT_LENGTH) });

commentsRouter.patch("/:id", async (req, res) => {
  const { user } = requireAuthed(req);
  limit(`comment-edit:${user.id}`, 40, "Editing is limited to 40 per hour");
  const body = await editSchema.parseAsync(req.body);

  const comment = (await prisma.comment.findUnique({
    where: { id: String(req.params.id) },
  })) as unknown as CommentRow | null;
  if (!comment || comment.deletedAt) {
    throw new ApiError(404, "COMMENT_NOT_FOUND", "No such comment");
  }
  if (comment.userId !== user.id) {
    throw new ApiError(403, "COMMENT_NOT_OWNED", "You can only edit your own comments");
  }
  if (Date.now() - new Date(comment.createdAt).getTime() > COMMENT_EDIT_WINDOW_MS) {
    throw new ApiError(
      403,
      "COMMENT_EDIT_WINDOW",
      `Comments can only be edited within ${COMMENT_EDIT_WINDOW_MS / 60000} minutes of posting`,
    );
  }

  const rendered = renderMarkdown(body.bodyMd);
  if (rendered.links > MAX_COMMENT_LINKS) {
    throw new ApiError(
      400,
      "COMMENT_TOO_MANY_LINKS",
      `Comments may contain at most ${MAX_COMMENT_LINKS} links`,
    );
  }

  const updated = (await prisma.comment.update({
    where: { id: comment.id },
    data: {
      bodyMd: body.bodyMd,
      bodyHtml: rendered.html,
      bodyHtmlVersion: MARKDOWN_VERSION,
      editedAt: new Date(),
    },
  })) as unknown as CommentRow;

  await audit({
    actorId: user.id,
    action: "comment.edit",
    target: String(comment.id),
    meta: { presetId: String(comment.presetId) },
    ip: clientIp(req),
  });

  res.json({
    comment: serializeComment(updated, {
      id: user.id,
      displayName: user.displayName,
      verified: user.verified,
    }),
  });
});

commentsRouter.delete("/:id", async (req, res) => {
  const { user } = requireAuthed(req);
  const comment = (await prisma.comment.findUnique({
    where: { id: String(req.params.id) },
  })) as unknown as CommentRow | null;
  if (!comment || comment.deletedAt) {
    throw new ApiError(404, "COMMENT_NOT_FOUND", "No such comment");
  }

  const isModerator = user.role === "ADMIN";
  if (comment.userId !== user.id && !isModerator) {
    throw new ApiError(403, "COMMENT_NOT_OWNED", "You can only delete your own comments");
  }

  await prisma.comment.update({
    where: { id: comment.id },
    data: { deletedAt: new Date(), bodyMd: "", bodyHtml: "" },
  });

  await audit({
    actorId: user.id,
    action: "comment.delete",
    target: String(comment.id),
    meta: { presetId: String(comment.presetId), moderator: isModerator },
    ip: clientIp(req),
  });

  res.status(204).end();
});
