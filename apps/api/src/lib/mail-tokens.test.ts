import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./prisma.js", async () => {
  const { fakePrisma } = await import("../test/fake-prisma.js");
  return { prisma: fakePrisma.client };
});

import { env } from "../config.js";
import { outbox } from "./mailer.js";
import { consumeToken, sendPasswordResetEmail, sendVerificationEmail } from "./mail-tokens.js";
import { fakePrisma } from "../test/fake-prisma.js";
import { hashToken } from "./tokens.js";

const user = { id: "user-1", email: "ada@example.com", displayName: "Ada" };

function lastMail() {
  return outbox[outbox.length - 1]!;
}

function tokenFrom(mailText: string): string {
  const match = /token=([A-Za-z0-9_-]+)/.exec(mailText);
  if (!match) throw new Error("no token in mail");
  return match[1]!;
}

beforeEach(() => {
  fakePrisma.reset();
  outbox.length = 0;
});

describe("sendVerificationEmail", () => {
  it("stores a hashed single-use token and mails the confirm link", async () => {
    await sendVerificationEmail(user);

    expect(outbox).toHaveLength(1);
    const mail = lastMail();
    expect(mail.to).toBe(user.email);
    expect(mail.subject).toContain("Confirm");

    const raw = tokenFrom(mail.text);
    const rows = fakePrisma.tables.emailToken;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashToken(raw));
    expect(rows[0]!.tokenHash).not.toBe(raw);
    expect(rows[0]!.type).toBe("EMAIL_VERIFY");
    expect(mail.text).toContain(`${env.APP_URL}/verify-email?token=${raw}`);
    expect(mail.text).toContain(user.displayName);
  });

  it("replaces any outstanding token for the same user and type", async () => {
    await sendVerificationEmail(user);
    const first = tokenFrom(lastMail().text);

    await sendVerificationEmail(user);
    const second = tokenFrom(lastMail().text);

    expect(second).not.toBe(first);
    expect(fakePrisma.tables.emailToken).toHaveLength(1);
    expect(await consumeToken(first, "EMAIL_VERIFY")).toBeNull();
    expect(await consumeToken(second, "EMAIL_VERIFY")).not.toBeNull();
  });

  it("sends to the pending address when an email change is staged", async () => {
    await sendVerificationEmail({ ...user, pendingEmail: "new@example.com" });

    const mail = lastMail();
    expect(mail.to).toBe("new@example.com");
    expect(mail.text).toContain("new@example.com");
  });
});

describe("sendPasswordResetEmail", () => {
  it("issues a 30-minute token and mails the reset link", async () => {
    await sendPasswordResetEmail(user);

    const mail = lastMail();
    expect(mail.subject).toContain("Reset");
    expect(mail.text).toContain(`${env.APP_URL}/reset-password?token=`);
    expect(mail.text).toContain("30 minutes");

    const row = fakePrisma.tables.emailToken[0]!;
    expect(row.type).toBe("PASSWORD_RESET");
    const ttl = (row.expiresAt as Date).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(29 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(30 * 60 * 1000);
  });
});

describe("consumeToken", () => {
  it("consumes a valid token exactly once", async () => {
    await sendPasswordResetEmail(user);
    const raw = tokenFrom(lastMail().text);

    const first = await consumeToken(raw, "PASSWORD_RESET");
    expect(first).toMatchObject({ userId: "user-1" });

    const second = await consumeToken(raw, "PASSWORD_RESET");
    expect(second).toBeNull();
    expect(fakePrisma.tables.emailToken[0]!.usedAt).toBeInstanceOf(Date);
  });

  it("rejects a token of the wrong type", async () => {
    await sendVerificationEmail(user);
    const raw = tokenFrom(lastMail().text);

    expect(await consumeToken(raw, "PASSWORD_RESET")).toBeNull();
  });

  it("rejects expired and unknown tokens", async () => {
    fakePrisma.seed("emailToken", {
      id: "t1",
      userId: "user-1",
      type: "PASSWORD_RESET",
      tokenHash: hashToken("expired-token-value"),
      expiresAt: new Date(Date.now() - 1000),
    });

    expect(await consumeToken("expired-token-value", "PASSWORD_RESET")).toBeNull();
    expect(await consumeToken("never-issued", "PASSWORD_RESET")).toBeNull();
  });
});
