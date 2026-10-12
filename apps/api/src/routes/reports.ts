import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { newId } from "../lib/id.js";
import { ApiError } from "../errors/problem.js";
import { audit, clientIp } from "../lib/audit.js";
import { checkRate, rateLimited } from "../lib/rate-limit.js";
import { requireAuthed, requireUser } from "../middleware/auth.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export const reportsRouter = Router();

reportsRouter.use((req, res, next) => {
  requireUser(req, res, next);
});

const reportSchema = z.object({
  targetType: z.enum(["preset", "comment"]),
  targetId: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(10).max(1000),
});

reportsRouter.post("/", async (req, res) => {
  const { user } = requireAuthed(req);
  const rate = checkRate(`report:${user.id}`, { windowMs: DAY_MS, max: 20 });
  if (!rate.allowed) rateLimited(rate, "Reports are limited to 20 per day");
  const body = await reportSchema.parseAsync(req.body);
  const targetType = body.targetType === "preset" ? "PRESET" : "COMMENT";

  const target =
    targetType === "PRESET"
      ? await prisma.preset.findUnique({ where: { id: body.targetId } })
      : await prisma.comment.findUnique({ where: { id: body.targetId } });
  if (!target) {
    throw new ApiError(404, "REPORT_TARGET_NOT_FOUND", "The reported content no longer exists");
  }

  const existing = await prisma.report.findFirst({
    where: { reporterId: user.id, targetType, targetId: body.targetId, status: "OPEN" },
  });
  if (existing) {
    throw new ApiError(409, "REPORT_DUPLICATE", "You already have an open report for this content");
  }

  const report = await prisma.report.create({
    data: {
      id: newId(),
      reporterId: user.id,
      targetType,
      targetId: body.targetId,
      reason: body.reason,
      status: "OPEN",
    },
  });

  await audit({
    actorId: user.id,
    action: "report.create",
    target: body.targetId,
    meta: { targetType, reportId: report.id },
    ip: clientIp(req),
  });

  res.status(201).json({
    report: {
      id: report.id,
      targetType: body.targetType,
      targetId: body.targetId,
      status: "open",
      createdAt: report.createdAt,
    },
  });
});
