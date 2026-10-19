export type ApiIssue = { path: string; message: string };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: ApiIssue[];

  constructor(status: number, code: string, message: string, issues: ApiIssue[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

export type ProfileLink = { label: string; url: string };

export type SelfUser = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  links: ProfileLink[];
  role: string;
  verified: boolean;
  createdAt: string;
  email: string;
  emailVerified: boolean;
  pendingEmail: string | null;
  totpEnabled: boolean;
  hasPassword: boolean;
  tosVersion: string;
  bannedAt: string | null;
};

export type GearItem = {
  pedalId: string;
  firmwareVersion: string | null;
  pedal: { id: string; brand: string; model: string; slug: string };
};

export type PedalSummary = {
  id: string;
  brand: string;
  model: string;
  slug: string;
  validationMode: string;
  extensions: string[];
  presetCount: number;
};

/** The signed-in user's pedal gear (from `GET /me`). */
export async function getMyGear(): Promise<GearItem[]> {
  const data = await api<{ user: SelfUser; gear: GearItem[] }>("/me");
  return Array.isArray(data.gear) ? data.gear : [];
}

/** Enabled catalog pedals, used by the gear picker. */
export async function listPedals(): Promise<PedalSummary[]> {
  const data = await api<{ pedals: PedalSummary[] }>("/pedals");
  return Array.isArray(data.pedals) ? data.pedals : [];
}

export type SessionInfo = {
  id: string;
  deviceName: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  current: boolean;
};

export type IdentityInfo = { provider: string; createdAt: string };

type ApiInit = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
};

/** Calls the GuitarHub API. Cookies are sent; errors become `ApiError`. */
export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Could not reach the server — check your connection");
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    const problem = (payload ?? {}) as {
      code?: string;
      title?: string;
      detail?: string;
      issues?: ApiIssue[];
    };
    const message = problem.detail ?? problem.title ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, problem.code ?? "ERROR", message, problem.issues ?? []);
  }

  return payload as T;
}

/** The signed-in user, or `null` when nobody is authenticated. */
export async function getCurrentUser(): Promise<SelfUser | null> {
  try {
    const data = await api<{ user: SelfUser }>("/me");
    return data.user;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null;
    throw err;
  }
}

export type PresetCounts = {
  up: number;
  down: number;
  score: number;
  comments: number;
  downloads: number;
  views: number;
};

export type PresetFileInfo = {
  role: string;
  size: number;
  ext: string;
  contentHash: string;
};

export type PresetItem = {
  id: string;
  section: string;
  title: string;
  descriptionMd: string;
  songTitle: string | null;
  artist: string | null;
  album: string | null;
  year: number | null;
  firmwareVersion: string;
  kind: string;
  cloudUrl: string | null;
  usesThirdPartyIr: boolean;
  version: number;
  status: string;
  contentHash: string | null;
  fileSize: number | null;
  fileExt: string | null;
  createdAt: string;
  updatedAt: string;
  pedal: { slug: string; brand: string; model: string };
  user: { id: string; displayName: string; verified: boolean };
  tags: { slug: string; label: string }[];
  files: PresetFileInfo[];
  counts: PresetCounts;
};

export type PresetDetail = PresetItem & {
  pedal: { slug: string; brand: string; model: string; importInstructionsMd: string };
  firmwareWarning: string | null;
  userVote: number;
  mine: boolean;
};

export type PresetListResult = {
  presets: PresetItem[];
  nextCursor: string | null;
  total: number;
};

export type BrowseParams = {
  pedal?: string;
  section?: string;
  tag?: string;
  q?: string;
  sort?: "hot" | "new" | "top" | "downloads" | "comments";
  usesIr?: boolean;
  verified?: boolean;
  cursor?: string | null;
  limit?: number;
};

export function listPresets(params: BrowseParams = {}): Promise<PresetListResult> {
  const search = new URLSearchParams();
  if (params.pedal) search.set("pedal", params.pedal);
  if (params.section) search.set("section", params.section);
  if (params.tag) search.set("tag", params.tag);
  if (params.q) search.set("q", params.q);
  if (params.sort) search.set("sort", params.sort);
  if (params.usesIr !== undefined) search.set("usesIr", String(params.usesIr));
  if (params.verified !== undefined) search.set("verified", String(params.verified));
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  const qs = search.toString();
  return api<PresetListResult>(`/presets${qs ? `?${qs}` : ""}`);
}

export async function getPreset(id: string): Promise<PresetDetail> {
  const data = await api<{ preset: PresetDetail }>(`/presets/${encodeURIComponent(id)}`);
  return data.preset;
}

export type VoteValue = -1 | 0 | 1;

export type VoteResult = {
  counts: { up: number; down: number; score: number };
  userVote: VoteValue;
};

export function votePreset(id: string, value: VoteValue): Promise<VoteResult> {
  return api<VoteResult>(`/presets/${encodeURIComponent(id)}/vote`, {
    method: "PUT",
    body: { value },
  });
}

export type CommentAuthor = { id: string; displayName: string; verified: boolean };

export type Comment = {
  id: string;
  parentId: string | null;
  bodyMd: string | null;
  bodyHtml: string | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  author: CommentAuthor | null;
  replies: Comment[];
};

export type CommentListResult = {
  comments: Comment[];
  nextCursor: string | null;
  total: number;
};

export function listComments(
  presetId: string,
  params: { cursor?: string | null; limit?: number } = {},
): Promise<CommentListResult> {
  const search = new URLSearchParams();
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  const qs = search.toString();
  return api<CommentListResult>(
    `/presets/${encodeURIComponent(presetId)}/comments${qs ? `?${qs}` : ""}`,
  );
}

export async function postComment(
  presetId: string,
  bodyMd: string,
  parentId?: string,
): Promise<Comment> {
  const data = await api<{ comment: Comment }>(
    `/presets/${encodeURIComponent(presetId)}/comments`,
    {
      method: "POST",
      body: { bodyMd, ...(parentId ? { parentId } : {}) },
    },
  );
  return data.comment;
}

export async function updateComment(commentId: string, bodyMd: string): Promise<Comment> {
  const data = await api<{ comment: Comment }>(`/comments/${encodeURIComponent(commentId)}`, {
    method: "PATCH",
    body: { bodyMd },
  });
  return data.comment;
}

export function deleteComment(commentId: string): Promise<void> {
  return api<void>(`/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" });
}

export function reportContent(input: {
  targetType: "preset" | "comment";
  targetId: string;
  reason: string;
}): Promise<{ report: { id: string; status: string } }> {
  return api<{ report: { id: string; status: string } }>("/reports", {
    method: "POST",
    body: input,
  });
}

/* ------------------------------------------------------------------ *
 * Admin & moderation (FR-7)
 * ------------------------------------------------------------------ */

export type AdminPedal = {
  id: string;
  brand: string;
  model: string;
  slug: string;
  aliases: string[];
  extensions: string[];
  validationMode: string;
  firmwareNotes: string | null;
  importInstructionsMd: string;
  maxPresetBytes: number;
  maxBundleBytes: number;
  maxCompanionBytes: number;
  enabled: boolean;
  presetCount: number;
};

export type AdminPedalInput = {
  brand: string;
  model: string;
  aliases?: string[];
  extensions?: string[];
  firmwareNotes?: string | null;
  importInstructionsMd?: string;
  validationMode: string;
  maxPresetBytes?: number;
  maxBundleBytes?: number;
  maxCompanionBytes?: number;
  enabled?: boolean;
};

export async function listAdminPedals(): Promise<AdminPedal[]> {
  const data = await api<{ pedals: AdminPedal[] }>("/admin/pedals");
  return data.pedals;
}

export async function createAdminPedal(input: AdminPedalInput): Promise<AdminPedal> {
  const data = await api<{ pedal: AdminPedal }>("/admin/pedals", { method: "POST", body: input });
  return data.pedal;
}

export async function updateAdminPedal(
  id: string,
  input: Partial<AdminPedalInput>,
): Promise<AdminPedal> {
  const data = await api<{ pedal: AdminPedal }>(`/admin/pedals/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
  });
  return data.pedal;
}

export type ReportTarget =
  | {
      type: "preset";
      id: string;
      title?: string;
      status?: string;
      owner?: { id: string; displayName: string } | null;
      missing?: boolean;
    }
  | {
      type: "comment";
      id: string;
      excerpt?: string;
      deleted?: boolean;
      preset?: { id: string; title: string } | null;
      owner?: { id: string; displayName: string } | null;
      missing?: boolean;
    };

export type AdminReport = {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  resolutionNote: string | null;
  handledAt: string | null;
  createdAt: string;
  reporter: { id: string; displayName: string } | null;
  target: ReportTarget;
};

export type AdminReportList = {
  reports: AdminReport[];
  page: number;
  limit: number;
  total: number;
  counts: { open: number; resolved: number; dismissed: number };
};

export function listAdminReports(
  params: { status?: "open" | "resolved" | "dismissed"; page?: number; limit?: number } = {},
): Promise<AdminReportList> {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.page) search.set("page", String(params.page));
  if (params.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  return api<AdminReportList>(`/admin/reports${qs ? `?${qs}` : ""}`);
}

export type StepUp = { password?: string; totp?: string };

export function resolveAdminReport(
  id: string,
  input: { action: "dismiss" | "hide" | "remove"; note?: string } & StepUp,
): Promise<{ report: { id: string; status: string; action: string } }> {
  return api(`/admin/reports/${encodeURIComponent(id)}/resolve`, { method: "POST", body: input });
}

export function banUser(
  id: string,
  input: { type: "hard" | "shadow"; reason: string } & StepUp,
): Promise<{ user: { id: string; banned: boolean } }> {
  return api(`/admin/users/${encodeURIComponent(id)}/ban`, { method: "POST", body: input });
}

export function unbanUser(
  id: string,
  input: StepUp = {},
): Promise<{ user: { id: string; banned: boolean } }> {
  return api(`/admin/users/${encodeURIComponent(id)}/unban`, { method: "POST", body: input });
}

export type AdminStats = {
  users: { total: number; verified: number; last30Days: number };
  presets: Record<string, number>;
  downloads: { total: number; events: number };
  storage: { bytes: number; files: number };
  engagement: { comments: number; votes: number; openReports: number };
  perPedal: { pedalId: string; brand: string; model: string; presets: number; downloads: number }[];
  recentSignups: { id: string; displayName: string; createdAt: string }[];
};

export function getAdminStats(): Promise<AdminStats> {
  return api<AdminStats>("/admin/stats");
}

export type AdminTag = {
  id: string;
  slug: string;
  label: string;
  blacklisted: boolean;
  presetCount: number;
};

export async function listAdminTags(): Promise<AdminTag[]> {
  const data = await api<{ tags: AdminTag[] }>("/admin/tags");
  return data.tags;
}

export async function createAdminTag(input: {
  slug: string;
  label: string;
  blacklisted?: boolean;
}): Promise<AdminTag> {
  const data = await api<{ tag: AdminTag }>("/admin/tags", { method: "POST", body: input });
  return data.tag;
}

export async function updateAdminTag(
  id: string,
  input: { slug?: string; label?: string; blacklisted?: boolean } & StepUp,
): Promise<{ tag: AdminTag; detached: number }> {
  return api(`/admin/tags/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
}

export async function mergeAdminTags(
  id: string,
  input: { targetTagId: string } & StepUp,
): Promise<{ merged: { sourceSlug: string; targetSlug: string; moved: number } }> {
  return api(`/admin/tags/${encodeURIComponent(id)}/merge`, { method: "POST", body: input });
}
