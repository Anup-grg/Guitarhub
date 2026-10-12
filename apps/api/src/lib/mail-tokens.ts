import { env } from "../config.js";
import { prisma } from "./prisma.js";
import { newId } from "./id.js";
import { randomToken, hashToken } from "./tokens.js";
import { sendMail } from "./mailer.js";

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

async function issueToken(
  userId: string,
  type: "EMAIL_VERIFY" | "PASSWORD_RESET",
  ttlMs: number,
): Promise<string> {
  const token = randomToken();
  await prisma.emailToken.deleteMany({ where: { userId, type } });
  await prisma.emailToken.create({
    data: {
      id: newId(),
      userId,
      type,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  return token;
}

export async function sendVerificationEmail(user: {
  id: string;
  email: string;
  displayName: string;
  pendingEmail?: string | null;
}): Promise<void> {
  const token = await issueToken(user.id, "EMAIL_VERIFY", EMAIL_VERIFY_TTL_MS);
  const target = user.pendingEmail ?? user.email;
  const link = `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: target,
    subject: "Confirm your GuitarHub email",
    text: [
      `Hi ${user.displayName},`,
      "",
      `Confirm ${target} for your GuitarHub account:`,
      link,
      "",
      "This link expires in 24 hours. If you did not create a GuitarHub account, ignore this email.",
    ].join("\n"),
  });
}

export async function sendPasswordResetEmail(user: {
  id: string;
  email: string;
  displayName: string;
}): Promise<void> {
  const token = await issueToken(user.id, "PASSWORD_RESET", PASSWORD_RESET_TTL_MS);
  const link = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: user.email,
    subject: "Reset your GuitarHub password",
    text: [
      `Hi ${user.displayName},`,
      "",
      "Choose a new password for your GuitarHub account:",
      link,
      "",
      "This link expires in 30 minutes and can only be used once.",
      "If you did not request this, no action is needed — your password is unchanged.",
    ].join("\n"),
  });
}

/** Consumes a single-use token if it matches type, TTL and is unused. */
export async function consumeToken(
  rawToken: string,
  type: "EMAIL_VERIFY" | "PASSWORD_RESET",
): Promise<{ id: string; userId: string } | null> {
  const record = await prisma.emailToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!record) return null;
  if (record.type !== type || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
    return null;
  }
  await prisma.emailToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  return { id: record.id, userId: record.userId };
}
