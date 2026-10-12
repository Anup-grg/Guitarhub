import type { User } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { normalizeLinks, publicUser, selfUser } from "./users.js";

const user = {
  id: "01J0000000000000000000000",
  email: "private@example.com",
  emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
  passwordHash: "$argon2id$secret",
  displayName: "Player One",
  avatarUrl: null,
  bio: "Hello",
  role: "USER",
  verified: false,
  tosVersion: "1.0",
  tosAcceptedAt: new Date("2026-01-01T00:00:00Z"),
  totpEnabled: false,
  totpSecret: "JBSWY3DPEHPK3PXP",
  totpPendingSecret: null,
  pendingEmail: null,
  links: [{ label: "Site", url: "https://example.com" }],
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  bannedAt: null,
  banType: null,
  banReason: null,
  deletedAt: null,
} as unknown as User;

describe("publicUser", () => {
  it("never exposes email, password hash or TOTP secret", () => {
    const json = JSON.stringify(publicUser(user));
    expect(json).not.toContain("private@example.com");
    expect(json).not.toContain("argon2id");
    expect(json).not.toContain("JBSWY3DPEHPK3PXP");
    expect(publicUser(user)).toMatchObject({
      id: user.id,
      displayName: "Player One",
      role: "USER",
    });
  });
});

describe("selfUser", () => {
  it("includes the owner's own private fields", () => {
    expect(selfUser(user)).toMatchObject({
      email: "private@example.com",
      emailVerified: true,
      hasPassword: true,
      totpEnabled: false,
      bannedAt: null,
    });
  });

  it("never exposes the password hash or TOTP secret", () => {
    const json = JSON.stringify(selfUser(user));
    expect(json).not.toContain("argon2id");
    expect(json).not.toContain("JBSWY3DPEHPK3PXP");
  });
});

describe("normalizeLinks", () => {
  it("keeps well-formed links and drops junk", () => {
    const links = normalizeLinks([
      { label: "OK", url: "https://ok.example" },
      { label: "bad" },
      "nope",
      null,
      { label: 42, url: "x" },
    ]);
    expect(links).toEqual([{ label: "OK", url: "https://ok.example" }]);
  });

  it("returns an empty list for non-arrays", () => {
    expect(normalizeLinks(null)).toEqual([]);
    expect(normalizeLinks("x")).toEqual([]);
    expect(normalizeLinks({})).toEqual([]);
  });
});
