import { createApp } from "./app.js";
import { env } from "./config.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { startPurgeJob } from "./jobs/purge-deleted.js";
import { startHotRankJob } from "./jobs/refresh-hot-rank.js";

const app = createApp();
if (env.TRUST_PROXY) app.set("trust proxy", true);
if (env.NODE_ENV !== "test") {
  startPurgeJob();
  startHotRankJob();
}

const server = app.listen(env.PORT, () => {
  logger.info(`guitarhub-api listening on http://localhost:${env.PORT}`);
});

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(() => {
    prisma
      .$disconnect()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
