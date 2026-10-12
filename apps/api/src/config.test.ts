import { describe, expect, it } from "vitest";
import { parseEnv } from "./config.js";

const base = { DATABASE_URL: "postgresql://user:pass@localhost:5432/db" };

describe("parseEnv", () => {
  it("applies defaults for optional variables", () => {
    const env = parseEnv({ ...base });
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(4000);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.DATABASE_URL).toBe(base.DATABASE_URL);
  });

  it("coerces PORT to a number", () => {
    expect(parseEnv({ ...base, PORT: "8080" }).PORT).toBe(8080);
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow();
    try {
      parseEnv({});
    } catch (e) {
      expect((e as { issues: { path: (string | number)[] }[] }).issues[0]?.path).toEqual([
        "DATABASE_URL",
      ]);
    }
  });

  it("rejects an empty DATABASE_URL", () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: "" })).toThrow();
  });

  it.each(["0", "-1", "70000", "not-a-port"])("rejects invalid PORT %s", (port) => {
    expect(() => parseEnv({ ...base, PORT: port })).toThrow();
  });

  it.each(["staging", "prod", ""])("rejects invalid NODE_ENV %s", (nodeEnv) => {
    expect(() => parseEnv({ ...base, NODE_ENV: nodeEnv })).toThrow();
  });

  it.each(["fatal", "error", "warn", "info", "debug", "trace", "silent"])(
    "accepts LOG_LEVEL %s",
    (level) => {
      expect(parseEnv({ ...base, LOG_LEVEL: level }).LOG_LEVEL).toBe(level);
    },
  );

  it("rejects an unknown LOG_LEVEL", () => {
    expect(() => parseEnv({ ...base, LOG_LEVEL: "verbose" })).toThrow();
  });
});
