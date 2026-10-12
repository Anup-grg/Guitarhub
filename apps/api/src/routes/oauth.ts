import { Router, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { newId } from "../lib/id.js";
import { env } from "../config.js";
import { ApiError } from "../errors/problem.js";
import { audit, clientIp } from "../lib/audit.js";
import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchProfile,
  isOAuthProvider,
  newPkcePair,
  statesMatch,
  type OAuthProvider,
} from "../lib/oauth.js";
import {
  createSession,
  setSessionCookies,
  loadSession,
  sessionCookieName,
} from "../lib/session.js";
import { randomToken } from "../lib/tokens.js";

export const oauthRouter = Router();

const STATE_COOKIE = "gh_oauth_state";
const PKCE_COOKIE = "gh_oauth_pkce";
const MODE_COOKIE = "gh_oauth_mode";
const TTL_MS = 10 * 60 * 1000;

function oauthCookies(res: Response, values: { state: string; verifier: string; mode: "login" | "link" }): void {
  const opts = {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax" as const,
    path: "/",
    maxAge: TTL_MS,
  };
  res.cookie(STATE_COOKIE, values.state, opts);
  res.cookie(PKCE_COOKIE, values.verifier, opts);
  res.cookie(MODE_COOKIE, values.mode, opts);
}

function clearOauthCookies(res: Response): void {
  const opts = { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: "lax" as const, path: "/" as const };
  res.clearCookie(STATE_COOKIE, opts);
  res.clearCookie(PKCE_COOKIE, opts);
  res.clearCookie(MODE_COOKIE, opts);
}

function parseProvider(raw: string): OAuthProvider {
  if (!isOAuthProvider(raw)) {
    throw new ApiError(404, "OAUTH_PROVIDER_NOT_FOUND", "Unknown sign-in provider");
  }
  return raw;
}

function loginRedirect(query: Record<string, string>): string {
  const url = new URL(`${env.APP_URL}/login`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}

oauthRouter.get("/oauth/:provider", (req, res) => {
  const provider = parseProvider(req.params.provider!);
  const state = randomToken(16);
  const { verifier, challenge } = newPkcePair();
  const mode = req.query.mode === "link" && req.auth ? "link" : "login";
  oauthCookies(res, { state, verifier, mode });
  res.redirect(302, buildAuthorizeUrl(provider, { state, challenge }));
});

oauthRouter.post("/oauth/:provider/link", (req, res) => {
  const provider = parseProvider(req.params.provider!);
  if (!req.auth) throw new ApiError(401, "UNAUTHORIZED", "Sign in to continue");
  const state = randomToken(16);
  const { verifier, challenge } = newPkcePair();
  oauthCookies(res, { state, verifier, mode: "link" });
  res.redirect(302, buildAuthorizeUrl(provider, { state, challenge }));
});

oauthRouter.get("/oauth/:provider/callback", async (req, res) => {
  const provider = parseProvider(req.params.provider!);
  const cookies = req.cookies ?? {};

  if (req.query.error) {
    clearOauthCookies(res);
    res.redirect(302, loginRedirect({ error: "oauth_denied", provider }));
    return;
  }
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  if (!code || !statesMatch(String(req.query.state ?? ""), cookies[STATE_COOKIE])) {
    clearOauthCookies(res);
    res.redirect(302, loginRedirect({ error: "oauth_state", provider }));
    return;
  }

  const verifier = cookies[PKCE_COOKIE] as string | undefined;
  const mode = cookies[MODE_COOKIE] === "link" ? "link" : "login";
  clearOauthCookies(res);
  if (!verifier) {
    res.redirect(302, loginRedirect({ error: "oauth_state", provider }));
    return;
  }

  const accessToken = await exchangeCode(provider, { code, verifier });
  const profile = await fetchProfile(provider, accessToken);

  if (mode === "link") {
    const loaded = await loadSession(cookies[sessionCookieName()]);
    if (!loaded.ok) {
      res.redirect(302, loginRedirect({ error: "session_expired", provider }));
      return;
    }
    const existing = await prisma.authIdentity.findUnique({
      where: { provider_providerUserId: { provider, providerUserId: profile.providerUserId } },
    });
    if (existing && existing.userId !== loaded.session.userId) {
      res.redirect(302, `${env.APP_URL}/settings?error=identity_taken&provider=${provider}`);
      return;
    }
    if (!existing) {
      await prisma.authIdentity.create({
        data: {
          id: newId(),
          userId: loaded.session.userId,
          provider,
          providerUserId: profile.providerUserId,
        },
      });
      await audit({
        actorId: loaded.session.userId,
        action: "auth.identity_linked",
        target: `provider:${provider}`,
        ip: clientIp(req),
      });
    }
    res.redirect(302, `${env.APP_URL}/settings?linked=${provider}`);
    return;
  }

  const identity = await prisma.authIdentity.findUnique({
    where: { provider_providerUserId: { provider, providerUserId: profile.providerUserId } },
    include: { user: true },
  });

  let user = identity?.user;

  if (!user && profile.email) {
    const byEmail = await prisma.user.findUnique({ where: { email: profile.email } });
    if (byEmail) {
      // Never auto-link by email collision — link from an authenticated session instead (SRS §6.2).
      res.redirect(302, loginRedirect({ error: "oauth_email_taken", provider }));
      return;
    }
  }

  if (!user) {
    const fallbackEmail = `${provider}-${profile.providerUserId}@${provider}.guitarhub.invalid`;
    const email = profile.email ?? fallbackEmail;
    const now = new Date();
    try {
      user = await prisma.user.create({
        data: {
          id: newId(),
          email,
          displayName: (profile.name ?? `${provider} player`).slice(0, 40),
          passwordHash: null,
          avatarUrl: profile.avatarUrl,
          emailVerifiedAt: profile.emailVerified && profile.email ? now : null,
          tosVersion: env.TOS_VERSION,
          tosAcceptedAt: now,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        res.redirect(302, loginRedirect({ error: "oauth_email_taken", provider }));
        return;
      }
      throw err;
    }
    await prisma.authIdentity.create({
      data: {
        id: newId(),
        userId: user.id,
        provider,
        providerUserId: profile.providerUserId,
      },
    });
    await audit({
      actorId: user.id,
      action: "auth.oauth_register",
      target: `provider:${provider}`,
      ip: clientIp(req),
    });
  }

  if (user.deletedAt) {
    res.redirect(302, loginRedirect({ error: "account_deleted", provider }));
    return;
  }
  if (user.bannedAt) {
    res.redirect(302, loginRedirect({ error: "account_banned", provider }));
    return;
  }

  const { session, refreshToken } = await createSession({
    userId: user.id,
    ip: clientIp(req),
    userAgent: req.get("user-agent"),
    stepUp: true,
    deviceName: `${provider} sign-in`,
  });
  setSessionCookies(res, session, refreshToken, false);
  await audit({
    actorId: user.id,
    action: "auth.oauth_login",
    target: `provider:${provider}`,
    ip: clientIp(req),
  });
  res.redirect(302, `${env.APP_URL}/`);
});

