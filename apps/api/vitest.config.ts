import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "prisma/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://postgres:test@127.0.0.1:5432/guitarhub_test?schema=public",
      LOG_LEVEL: "silent",
    },
  },
});
