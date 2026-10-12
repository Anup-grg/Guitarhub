import { createHash, randomBytes } from "node:crypto";
import { env } from "../config.js";
import { ApiError } from "../errors/problem.js";
import { safeEqual } from "./tokens.js";

export const OAUTH_PROVIDERS = ["google", "github"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProvider(value: string): value is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

export type ProviderProfile = {
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
};

function config(provider: OAuthProvider) {
  if (provider === "google") {
    const clientId = env.OAUTH_GOOGLE_CLIENT_ID;
    const clientSecret = env.OAUTH_GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return {
      clientId,
      clientSecret,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scope: "openid email profile",
      provider,
    } as const;
  }
  const clientId = env.OAUTH_GITHUB_CLIENT_ID;
  const clientSecret = env.OAUTH_GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    provider,
  } as const;
}

export function isProviderConfigured(provider: OAuthProvider): boolean {
  return config(provider) !== null;
}

export function redirectUri(provider: OAuthProvider): string {
  return `${env.APP_URL}/api/v1/auth/oauth/${provider}/callback`;
}

export function newPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function buildAuthorizeUrl(
  provider: OAuthProvider,
  opts: { state: string; challenge: string },
): string {
  const cfg = config(provider);
  if (!cfg) throw new ApiError(404, "OAUTH_NOT_CONFIGURED", "This sign-in provider is not enabled");
  const url = new URL(cfg.authorizeUrl);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", redirectUri(provider));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", cfg.scope);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (provider === "google") url.searchParams.set("access_type", "online");
  return url.toString();
}

export async function exchangeCode(
  provider: OAuthProvider,
  opts: { code: string; verifier: string },
): Promise<string> {
  const cfg = config(provider);
  if (!cfg) throw new ApiError(404, "OAUTH_NOT_CONFIGURED", "This sign-in provider is not enabled");
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code: opts.code,
      code_verifier: opts.verifier,
      redirect_uri: redirectUri(provider),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new ApiError(400, "OAUTH_EXCHANGE_FAILED", "Could not complete sign-in");
  const body = (await res.json()) as { access_token?: string; error?: string };
  if (!body.access_token) {
    throw new ApiError(400, "OAUTH_EXCHANGE_FAILED", "Could not complete sign-in");
  }
  return body.access_token;
}

export async function fetchProfile(
  provider: OAuthProvider,
  accessToken: string,
): Promise<ProviderProfile> {
  const cfg = config(provider);
  if (!cfg) throw new ApiError(404, "OAUTH_NOT_CONFIGURED", "This sign-in provider is not enabled");

  const get = async (url: string): Promise<Record<string, unknown>> => {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "GuitarHub",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new ApiError(400, "OAUTH_PROFILE_FAILED", "Could not read your provider profile");
    return (await res.json()) as Record<string, unknown>;
  };

  if (provider === "google") {
    const data = await get("https://openidconnect.googleapis.com/v1/userinfo");
    return {
      providerUserId: String(data.sub),
      email: typeof data.email === "string" ? data.email.toLowerCase() : null,
      emailVerified: data.email_verified === true,
      name: typeof data.name === "string" ? data.name : null,
      avatarUrl: typeof data.picture === "string" ? data.picture : null,
    };
  }

  const data = await get("https://api.github.com/user");
  let email = typeof data.email === "string" && data.email ? data.email.toLowerCase() : null;
  let emailVerified = false;
  if (!email) {
    const emails = (await get("https://api.github.com/user/emails")) as unknown as {
      email: string;
      primary: boolean;
      verified: boolean;
    }[];
    const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    if (primary) {
      email = primary.email.toLowerCase();
      emailVerified = primary.verified;
    }
  } else {
    emailVerified = true;
  }
  return {
    providerUserId: String(data.id),
    email,
    emailVerified,
    name: typeof data.name === "string" && data.name ? data.name : null,
    avatarUrl: typeof data.avatar_url === "string" ? data.avatar_url : null,
  };
}

export function statesMatch(a: string | undefined, b: string | undefined): boolean {
  return Boolean(a && b && safeEqual(a, b));
}
