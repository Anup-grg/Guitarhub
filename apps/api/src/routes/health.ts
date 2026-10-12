import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  let db: "up" | "down" = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "up";
  } catch {
    db = "down";
  }
  res.json({
    status: db === "up" ? "ok" : "degraded",
    service: "guitarhub-api",
    db,
    time: new Date().toISOString(),
  });
});
