import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const boolishOf = (fallback: "true" | "false") =>
  z
    .enum(["true", "false", "1", "0"])
    .default(fallback)
    .transform((v) => v === "true" || v === "1");

const boolish = boolishOf("false");

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  // Public origin of the web app (used for links in emails, OAuth redirects, CSRF).
  APP_URL: z.string().url().default("http://localhost:3000"),
  // Set to "true" behind TLS so auth cookies get the `__Host-` prefix + Secure flag.
  COOKIE_SECURE: boolish,
  // Honor X-Forwarded-* headers when running behind the Caddy reverse proxy.
  TRUST_PROXY: boolish,

  // Terms of Service / Community Guidelines version recorded at registration.
  TOS_VERSION: z.string().min(1).default("1.0"),

  // OAuth 2.0 providers (Authorization Code + PKCE). Empty = provider disabled.
  OAUTH_GOOGLE_CLIENT_ID: z.string().default(""),
  OAUTH_GOOGLE_CLIENT_SECRET: z.string().default(""),
  OAUTH_GITHUB_CLIENT_ID: z.string().default(""),
  OAUTH_GITHUB_CLIENT_SECRET: z.string().default(""),

  // Outbound email. Empty SMTP_URL logs mails to the process output (dev outbox).
  SMTP_URL: z.string().default(""),
  MAIL_FROM: z.string().default("GuitarHub <no-reply@guitarhub.local>"),

  // Have I Been Pwned k-anonymity range check (enabled by default in production).
  HIBP_CHECK: boolish,

  // Object storage for preset files (SRS §3.2 / FR-2.4).
  // "local" stores objects on disk and serves pre-signed-style PUTs through this API
  // (dev default — no MinIO needed); "s3" speaks the S3 API (MinIO or AWS).
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_ENDPOINT: z.string().default("http://localhost:9000"),
  STORAGE_REGION: z.string().default("us-east-1"),
  STORAGE_BUCKET: z.string().min(1).default("guitarhub-presets"),
  STORAGE_ACCESS_KEY: z.string().default("guitarhub"),
  STORAGE_SECRET_KEY: z.string().default("GuitarHub_dev_2026"),
  STORAGE_FORCE_PATH_STYLE: boolishOf("true"),
  // Secret for HMAC-signing local upload URLs (STORAGE_DRIVER=local).
  STORAGE_SIGNING_SECRET: z.string().min(16).default("guitarhub-local-storage-signing-key"),
  // Directory for STORAGE_DRIVER=local objects (relative to the API working dir).
  STORAGE_LOCAL_DIR: z.string().default(".local-objects"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  return envSchema.parse(raw);
}

export const env: Env = parseEnv(process.env);
