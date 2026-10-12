import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { errorHandler, notFoundHandler } from "./errors/problem.js";
import { logger } from "./lib/logger.js";
import { attachUser, csrfGuard } from "./middleware/auth.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { oauthRouter } from "./routes/oauth.js";
import { meRouter } from "./routes/me.js";
import { pedalsRouter } from "./routes/pedals.js";
import { presetsRouter } from "./routes/presets.js";
import { commentsRouter } from "./routes/comments.js";
import { reportsRouter } from "./routes/reports.js";
import { storageLocalRouter } from "./routes/storage-local.js";
import { tagsRouter } from "./routes/tags.js";
import { adminRouter } from "./routes/admin.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        ignore: (req) => req.url === "/api/v1/health",
      },
    }),
  );

  app.use(attachUser);
  app.use(csrfGuard);

  app.use("/api/v1/health", healthRouter);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/auth", oauthRouter);
  app.use("/api/v1/me", meRouter);
  app.use("/api/v1/pedals", pedalsRouter);
  app.use("/api/v1/presets", presetsRouter);
  app.use("/api/v1/comments", commentsRouter);
  app.use("/api/v1/reports", reportsRouter);
  app.use("/api/v1/tags", tagsRouter);
  app.use("/api/v1/admin", adminRouter);
  app.use("/api/v1/storage/local", storageLocalRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
