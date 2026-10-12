import { logger } from "../lib/logger.js";
import { refreshAllHotRank } from "../lib/hot-rank.js";

/** SRS §7.3.4 — refresh cached trending scores every 5 minutes. */
const REFRESH_MS = 5 * 60 * 1000;

export function startHotRankJob(): NodeJS.Timeout {
  const run = () => {
    void refreshAllHotRank()
      .then((count) => {
        if (count > 0) logger.debug({ count }, "refreshed cached hot ranks");
      })
      .catch((err) => logger.error({ err }, "hot rank refresh failed"));
  };
  run();
  const timer = setInterval(run, REFRESH_MS);
  timer.unref();
  return timer;
}
