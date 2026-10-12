import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const tagsRouter = Router();

tagsRouter.get("/", async (_req, res) => {
  const tags = await prisma.tag.findMany({
    where: { blacklisted: false },
    orderBy: { label: "asc" },
  });
  res.json({ tags: tags.map((t) => ({ id: t.id, slug: t.slug, label: t.label })) });
});