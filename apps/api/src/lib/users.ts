import type { User } from "@prisma/client";

export type ProfileLink = { label: string; url: string };

/** Hard bans lock the account; shadow bans stay invisible and only suppress content (FR-7.2). */
export function isHardBanned(user: Pick<User, "bannedAt" | "banType">): boolean {
  return Boolean(user.bannedAt) && user.banType !== "SHADOW";
}

export function normalizeLinks(value: unknown): ProfileLink[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is ProfileLink =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as ProfileLink).label === "string" &&
      typeof (item as ProfileLink).url === "string",
  );
}

/** Any authenticated viewer may see these fields — never emails or IPs (SRS §6.6). */
export function publicUser(user: User) {
  return {
    id: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    links: normalizeLinks(user.links),
    role: user.role,
    verified: user.verified,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Self profile — the only place emails are ever returned. */
export function selfUser(user: User) {
  return {
    ...publicUser(user),
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    pendingEmail: user.pendingEmail,
    totpEnabled: user.totpEnabled,
    hasPassword: Boolean(user.passwordHash),
    tosVersion: user.tosVersion,
    bannedAt: user.bannedAt?.toISOString() ?? null,
  };
}
