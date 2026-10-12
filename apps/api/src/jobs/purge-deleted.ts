import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

/** FR-1.7 / §6.8 — PII is hard-deleted 30 days after soft deletion. */
const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function purgeDeletedAccounts(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PURGE_AFTER_MS);
  const { count } = await prisma.user.deleteMany({ where: { deletedAt: { lte: cutoff } } });
  if (count > 0) logger.info({ count }, "hard-deleted accounts past the 30-day window");
  return count;
}

export function startPurgeJob(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void purgeDeletedAccounts().catch((err) => logger.error({ err }, "account purge failed"));
  }, DAY_MS);
  timer.unref();
  return timer;
}
