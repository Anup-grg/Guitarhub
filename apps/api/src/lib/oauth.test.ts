import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config.js";
import { ApiError } from "../errors/problem.js";
import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchProfile,
  isOAuthProvider,
  isProviderConfigured,
  newPkcePair,
  redirectUri,
  statesMatch,
} from "./oauth.js";

type FetchArgs = [input: string | URL | Request, init?: RequestInit];

beforeEach(() => {
  env.OAUTH_GOOGLE_CLIENT_ID = "gid";
  env.OAUTH_GOOGLE_CLIENT_SECRET = "gsecret";
  env.OAUTH_GITHUB_CLIENT_ID = "";
  env.OAUTH_GITHUB_CLIENT_SECRET = "";
});

afterEach(() => {
  env.OAUTH_GOOGLE_CLIENT_ID = "";
  env.OAUTH_GOOGLE_CLIENT_SECRET = "";
  vi.unstubAllGlobals();
});

describe("provider helpers", () => {
  it("knows the supported providers", () => {
    expect(isOAuthProvider("google")).toBe(true);
    expect(isOAuthProvider("github")).toBe(true);
    expect(isOAuthProvider("steam")).toBe(false);
  });

  it("reports configuration per provider", () => {
    expect(isProviderConfigured("google")).toBe(true);
    expect(isProviderConfigured("github")).toBe(false);

    env.OAUTH_GITHUB_CLIENT_ID = "cid";
    expect(isProviderConfigured("github")).toBe(false); // secret still missing
    env.OAUTH_GITHUB_CLIENT_SECRET = "s";
    expect(isProviderConfigured("github")).toBe(true);
  });

  it("builds the callback URL from the app origin", () => {
    expect(redirectUri("github")).toBe(`${env.APP_URL}/api/v1/auth/oauth/github/callback`);
  });
});

describe("PKCE", () => {
  it("derives an S256 challenge from the verifier", () => {
    const { verifier, challenge } = newPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newPkcePair().verifier).not.toBe(verifier);
  });

  it("matches equal states only", () => {
    expect(statesMatch("abc", "abc")).toBe(true);
    expect(statesMatch("abc", "abd")).toBe(false);
    expect(statesMatch(undefined, "abc")).toBe(false);
    expect(statesMatch("abc", undefined)).toBe(false);
    expect(statesMatch("", "")).toBe(false);
  });
});

describe("buildAuthorizeUrl", () => {
  it("throws when the provider is not configured", () => {
    env.OAUTH_GOOGLE_CLIENT_ID = "";
    let thrown: unknown;
    try {
      buildAuthorizeUrl("google", { state: "s", challenge: "c" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).code).toBe("OAUTH_NOT_CONFIGURED");
  });

  it("carries PKCE, state and redirect_uri for Google", () => {
    const url = new URL(buildAuthorizeUrl("google", { state: "st", challenge: "ch" }));

    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("gid");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("code_challenge")).toBe("ch");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri("google"));
    expect(url.searchParams.get("access_type")).toBe("online");
    expect(url.searchParams.get("scope")).toContain("email");
  });

  it("uses GitHub endpoints and scopes", () => {
    env.OAUTH_GITHUB_CLIENT_ID = "hid";
    env.OAUTH_GITHUB_CLIENT_SECRET = "hs";

    const url = new URL(buildAuthorizeUrl("github", { state: "st", challenge: "ch" }));

    expect(url.hostname).toBe("github.com");
    expect(url.searchParams.get("client_id")).toBe("hid");
    expect(url.searchParams.get("scope")).toBe("read:user user:email");
    expect(url.searchParams.get("access_type")).toBeNull();
  });
});

describe("exchangeCode", () => {
  it("posts the code + verifier and returns the access token", async () => {
    const fetchMock = vi.fn(async (..._args: FetchArgs) => ({
      ok: true,
      json: async () => ({ access_token: "tok-123" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const token = await exchangeCode("google", { code: "c1", verifier: "v1" });

    expect(token).toBe("tok-123");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(init!.body as string);
    expect(body.get("code")).toBe("c1");
    expect(body.get("code_verifier")).toBe("v1");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(init!.headers).toMatchObject({ "Content-Type": "application/x-www-form-urlencoded" });
  });

  it("fails on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (..._args: FetchArgs) => ({ ok: false, json: async () => ({}) })),
    );

    await expect(exchangeCode("google", { code: "c", verifier: "v" })).rejects.toMatchObject({
      status: 400,
      code: "OAUTH_EXCHANGE_FAILED",
    });
  });

  it("fails when the token is missing from the body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ error: "bad" }) })),
    );

    await expect(exchangeCode("google", { code: "c", verifier: "v" })).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});

describe("fetchProfile", () => {
  it("maps a Google userinfo payload", async () => {
    const fetchMock = vi.fn(async (..._args: FetchArgs) => ({
      ok: true,
      json: async () => ({
        sub: "g-9",
        email: "Ada@Example.com",
        email_verified: true,
        name: "Ada L.",
        picture: "https://img",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const profile = await fetchProfile("google", "tok");

    expect(profile).toEqual({
      providerUserId: "g-9",
      email: "ada@example.com",
      emailVerified: true,
      name: "Ada L.",
      avatarUrl: "https://img",
    });
    expect(String(fetchMock.mock.calls[0]![0])).toContain("openidconnect.googleapis.com");
  });

  it("maps a GitHub profile that exposes its email", async () => {
    env.OAUTH_GITHUB_CLIENT_ID = "hid";
    env.OAUTH_GITHUB_CLIENT_SECRET = "hs";
    const fetchMock = vi.fn(async (..._args: FetchArgs) => ({
      ok: true,
      json: async () => ({
        id: 42,
        email: "dev@example.com",
        name: "Dev",
        avatar_url: "https://img",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const profile = await fetchProfile("github", "tok");

    expect(profile).toEqual({
      providerUserId: "42",
      email: "dev@example.com",
      emailVerified: true,
      name: "Dev",
      avatarUrl: "https://img",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the GitHub emails endpoint and picks the verified primary", async () => {
    env.OAUTH_GITHUB_CLIENT_ID = "hid";
    env.OAUTH_GITHUB_CLIENT_SECRET = "hs";
    const fetchMock = vi.fn(async (url: string, ..._rest: FetchArgs) => ({
      ok: true,
      json: async () =>
        String(url).endsWith("/user/emails")
          ? [
              { email: "other@example.com", primary: false, verified: true },
              { email: "primary@example.com", primary: true, verified: true },
            ]
          : { id: 7, email: null, name: null, avatar_url: null },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const profile = await fetchProfile("github", "tok");

    expect(profile.email).toBe("primary@example.com");
    expect(profile.emailVerified).toBe(true);
    expect(profile.providerUserId).toBe("7");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails when the provider rejects the profile request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (..._args: FetchArgs) => ({ ok: false, json: async () => ({}) })),
    );

    await expect(fetchProfile("google", "tok")).rejects.toMatchObject({
      code: "OAUTH_PROFILE_FAILED",
    });
  });
});
