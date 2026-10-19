/**
 * In-memory stand-in for the subset of Prisma the API uses.
 * Route tests run against it so they exercise real handlers without a database.
 *
 * Supported: findUnique / findFirst / findMany / count / create / createMany /
 * update / updateMany / delete / deleteMany / $transaction (array form).
 */
type Row = Record<string, unknown>;

const MODELS = [
  "user",
  "session",
  "emailToken",
  "twoFactorRecoveryCode",
  "authIdentity",
  "userGear",
  "pedal",
  "preset",
  "presetFile",
  "tag",
  "presetTag",
  "vote",
  "comment",
  "report",
  "downloadEvent",
  "auditLog",
] as const;

type Model = (typeof MODELS)[number];

const UNIQUE_KEYS: Record<Model, string[][]> = {
  user: [["email"]],
  session: [["refreshTokenHash"]],
  emailToken: [["tokenHash"]],
  twoFactorRecoveryCode: [["userId", "codeHash"]],
  authIdentity: [["provider", "providerUserId"]],
  userGear: [["userId", "pedalId"]],
  pedal: [["slug"]],
  preset: [],
  presetFile: [],
  tag: [["slug"]],
  presetTag: [["presetId", "tagId"]],
  vote: [["userId", "presetId"]],
  comment: [],
  report: [],
  downloadEvent: [["presetId", "clientKey", "day"]],
  auditLog: [],
};

const DEFAULTS: Record<Model, (data: Row, now: Date) => Row> = {
  user: (d, now) => ({
    passwordHash: null,
    emailVerifiedAt: null,
    avatarUrl: null,
    bio: null,
    role: "USER",
    verified: false,
    tosVersion: null,
    tosAcceptedAt: null,
    totpEnabled: false,
    totpSecret: null,
    totpPendingSecret: null,
    pendingEmail: null,
    links: null,
    bannedAt: null,
    banType: null,
    banReason: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...d,
  }),
  session: (d, now) => ({
    refreshTokenHash: null,
    usedHashes: [],
    deviceName: null,
    ip: null,
    userAgent: null,
    stepUpAt: null,
    lastSeenAt: null,
    revokedAt: null,
    createdAt: now,
    ...d,
  }),
  emailToken: (d, now) => ({ usedAt: null, createdAt: now, ...d }),
  twoFactorRecoveryCode: (d, now) => ({ usedAt: null, createdAt: now, ...d }),
  authIdentity: (d, now) => ({ createdAt: now, ...d }),
  userGear: (d) => ({ firmwareVersion: null, ...d }),
  pedal: (d, now) => ({
    aliases: [],
    enabled: true,
    importInstructionsMd: "",
    maxPresetBytes: 1048576,
    maxBundleBytes: 20971520,
    maxCompanionBytes: 5242880,
    createdAt: now,
    updatedAt: now,
    ...d,
  }),
  preset: (d, now) => ({
    status: "DRAFT",
    version: 1,
    downloadCount: 0,
    viewCount: 0,
    hotRank: 0,
    createdAt: now,
    updatedAt: now,
    ...d,
  }),
  presetFile: (d, now) => ({ mime: null, createdAt: now, ...d }),
  tag: (d) => ({ blacklisted: false, ...d }),
  presetTag: (d) => ({ ...d }),
  vote: (d, now) => ({ createdAt: now, ...d }),
  comment: (d, now) => ({
    bodyHtml: null,
    bodyHtmlVersion: 1,
    editedAt: null,
    deletedAt: null,
    createdAt: now,
    ...d,
  }),
  report: (d, now) => ({
    status: "OPEN",
    handledBy: null,
    handledAt: null,
    resolutionNote: null,
    createdAt: now,
    ...d,
  }),
  downloadEvent: (d, now) => ({ createdAt: now, ...d }),
  auditLog: (d, now) => ({ actorId: null, meta: null, ip: null, createdAt: now, ...d }),
};

function eq(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || a === undefined) return b === null || b === undefined;
  return a === b;
}

function matchesOperator(value: unknown, op: string, expected: unknown): boolean {
  switch (op) {
    case "equals":
      return eq(value, expected);
    case "not":
      if (expected === null) return value !== null && value !== undefined;
      return !eq(value, expected);
    case "in":
      return Array.isArray(expected) && expected.some((v) => eq(v, value));
    case "has":
      return Array.isArray(value) && value.includes(expected);
    case "gt":
      return value instanceof Date && expected instanceof Date && value > expected;
    case "gte":
      return value instanceof Date && expected instanceof Date && value >= expected;
    case "lt":
      return value instanceof Date && expected instanceof Date && value < expected;
    case "lte":
      return value instanceof Date && expected instanceof Date && value <= expected;
    case "startsWith":
      return (
        typeof value === "string" && typeof expected === "string" && value.startsWith(expected)
      );
    case "endsWith":
      return typeof value === "string" && typeof expected === "string" && value.endsWith(expected);
    case "contains":
      return typeof value === "string" && typeof expected === "string" && value.includes(expected);
    default:
      throw new Error(`fake-prisma: unsupported where operator "${op}"`);
  }
}

function nestedWhere(row: Row, cond: unknown): boolean {
  if (!cond) return false;
  if (Array.isArray(cond)) return cond.some((w) => matchWhere(row, w as Row));
  return matchWhere(row, cond as Row);
}

function matchWhere(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      if (!cond || !Array.isArray(cond) || !cond.some((w) => matchWhere(row, w as Row)))
        return false;
      continue;
    }
    if (key === "AND") {
      if (!cond || !Array.isArray(cond) || !cond.every((w) => matchWhere(row, w as Row)))
        return false;
      continue;
    }
    if (key === "NOT") {
      if (nestedWhere(row, cond)) return false;
      continue;
    }
    if (key === "provider_providerUserId") {
      const compound = cond as { provider: string; providerUserId: string };
      if (row.provider !== compound.provider || row.providerUserId !== compound.providerUserId) {
        return false;
      }
      continue;
    }
    const value = row[key];
    if (
      cond !== null &&
      typeof cond === "object" &&
      !(cond instanceof Date) &&
      !Array.isArray(cond)
    ) {
      for (const [op, expected] of Object.entries(cond as Row)) {
        if (op === "mode") continue;
        if (!matchesOperator(value, op, expected)) return false;
      }
    } else if (!eq(value, cond)) {
      return false;
    }
  }
  return true;
}

function matches(row: Row, where: Row | undefined): boolean {
  return matchWhere(row, where);
}

function applySelect(row: Row, select: Row | undefined): Row {
  if (!select) return row;
  const out: Row = {};
  for (const [key, on] of Object.entries(select)) {
    if (on) out[key] = row[key];
  }
  return out;
}

function attachInclude(model: Model, row: Row, include: Row | undefined): Row {
  if (!include) return { ...row };
  const out: Row = { ...row };
  if ((model === "session" || model === "authIdentity") && include.user) {
    const user = tables.user.find((u) => u.id === row.userId);
    out.user = user ? { ...user } : null;
  }
  if (model === "userGear" && include.pedal) {
    const pedal = tables.pedal.find((p) => p.id === row.pedalId);
    const opts = include.pedal as true | { select?: Row };
    out.pedal = pedal ? applySelect(pedal, opts === true ? undefined : opts.select) : null;
  }
  return out;
}

function getPath(row: Row, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Row)[key];
    return undefined;
  }, row);
}

function sortRows(rows: Row[], orderBy: Row | undefined): Row[] {
  if (!orderBy) return rows;
  const [field, dirOrNested] = Object.entries(orderBy)[0] as [string, unknown];
  const nested = typeof dirOrNested === "object" ? (dirOrNested as Row) : undefined;
  const [nestedField, order] = nested
    ? (Object.entries(nested)[0] as [string, string])
    : ["", String(dirOrNested)];
  const path = nested ? `${field}.${nestedField}` : field;
  const sign = order === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = getPath(a, path) as never;
    const bv = getPath(b, path) as never;
    if (av === bv) return 0;
    if (av === null || av === undefined) return -sign;
    if (bv === null || bv === undefined) return sign;
    return (av > bv ? 1 : -1) * sign;
  });
}

type Tables = Record<Model, Row[]>;

const tables: Tables = {
  user: [],
  session: [],
  emailToken: [],
  twoFactorRecoveryCode: [],
  authIdentity: [],
  userGear: [],
  pedal: [],
  preset: [],
  presetFile: [],
  tag: [],
  presetTag: [],
  vote: [],
  comment: [],
  report: [],
  downloadEvent: [],
  auditLog: [],
};

function fail(code: string, message: string): never {
  const err = new Error(message);
  (err as { code?: string }).code = code;
  throw err;
}

function checkUnique(model: Model, candidate: Row, exclude?: Row): void {
  for (const keys of UNIQUE_KEYS[model]) {
    if (keys.some((k) => candidate[k] === undefined)) continue;
    const conflict = tables[model].some(
      (row) => row !== exclude && keys.every((k) => eq(row[k], candidate[k])),
    );
    if (conflict) {
      fail("P2002", `Unique constraint failed on ${model}.${keys.join("_")}`);
    }
  }
}

function lazy<T>(fn: () => T): Promise<T> {
  let started: Promise<T> | undefined;
  const run = (): Promise<T> => (started ??= Promise.resolve().then(fn));
  return {
    then: (onFulfilled?: unknown, onRejected?: unknown) =>
      run().then(onFulfilled as never, onRejected as never),
    catch: (onRejected?: unknown) => run().catch(onRejected as never),
    finally: (onFinally?: unknown) => run().finally(onFinally as never),
    [Symbol.toStringTag]: "PrismaPromise",
  } as unknown as Promise<T>;
}

type Args = Record<string, unknown> | undefined;

function applyData(row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value)) {
      const inc = (value as { increment?: number }).increment;
      if (inc !== undefined) {
        row[key] = Number((row[key] as number) ?? 0) + inc;
        continue;
      }
      const dec = (value as { decrement?: number }).decrement;
      if (dec !== undefined) {
        row[key] = Number((row[key] as number) ?? 0) - dec;
        continue;
      }
    }
    row[key] = value;
  }
}

function modelClient(model: Model) {
  const find = (args: Args, ordered: boolean): Row | null => {
    const rows = tables[model].filter((row) => matches(row, args?.where as Row | undefined));
    const first = ordered
      ? (sortRows(rows, args?.orderBy as Row | undefined)[0] ?? null)
      : (rows[0] ?? null);
    if (!first) return null;
    return applySelect(
      attachInclude(model, first, args?.include as Row | undefined),
      args?.select as Row | undefined,
    );
  };

  return {
    findUnique: (args?: Args) => lazy(() => find(args, false)),
    findFirst: (args?: Args) => lazy(() => find(args, true)),
    findMany: (args?: Args) =>
      lazy(() => {
        const rows = tables[model].filter((row) => matches(row, args?.where as Row | undefined));
        let out = sortRows(
          rows.map((row) => attachInclude(model, row, args?.include as Row | undefined)),
          args?.orderBy as Row | undefined,
        );
        out = out.map((row) => applySelect(row, args?.select as Row | undefined));
        const skip = args?.skip as number | undefined;
        if (skip) out = out.slice(skip);
        const take = args?.take as number | undefined;
        return take !== undefined ? out.slice(0, take) : out;
      }),
    count: (args?: Args) =>
      lazy(
        () => tables[model].filter((row) => matches(row, args?.where as Row | undefined)).length,
      ),
    create: (args: { data: Row }) =>
      lazy(() => {
        const row = DEFAULTS[model](args.data, new Date());
        checkUnique(model, row);
        tables[model].push(row);
        return { ...row };
      }),
    createMany: (args: { data: Row[] }) =>
      lazy(() => {
        for (const data of args.data) {
          const row = DEFAULTS[model](data, new Date());
          checkUnique(model, row);
          tables[model].push(row);
        }
        return { count: args.data.length };
      }),
    update: (args: { where: Row; data: Row }) =>
      lazy(() => {
        const row = tables[model].find((r) => matches(r, args.where));
        if (!row) fail("P2025", `No ${model} found for update`);
        applyData(row, args.data);
        checkUnique(model, row, row);
        if ("updatedAt" in row) row.updatedAt = new Date();
        return { ...row };
      }),
    updateMany: (args: { where?: Row; data: Row }) =>
      lazy(() => {
        let count = 0;
        for (const row of tables[model]) {
          if (matches(row, args.where)) {
            applyData(row, args.data);
            if ("updatedAt" in row) row.updatedAt = new Date();
            count += 1;
          }
        }
        return { count };
      }),
    delete: (args: { where: Row }) =>
      lazy(() => {
        const index = tables[model].findIndex((row) => matches(row, args.where));
        if (index < 0) fail("P2025", `No ${model} found for delete`);
        return tables[model].splice(index, 1)[0]!;
      }),
    deleteMany: (args?: Args) =>
      lazy(() => {
        const keep = tables[model].filter((row) => !matches(row, args?.where as Row | undefined));
        const count = tables[model].length - keep.length;
        tables[model].splice(0, tables[model].length, ...keep);
        return { count };
      }),
  };
}

export const fakePrisma = {
  tables,
  client: {
    user: modelClient("user"),
    session: modelClient("session"),
    emailToken: modelClient("emailToken"),
    twoFactorRecoveryCode: modelClient("twoFactorRecoveryCode"),
    authIdentity: modelClient("authIdentity"),
    userGear: modelClient("userGear"),
    pedal: modelClient("pedal"),
    preset: modelClient("preset"),
    presetFile: modelClient("presetFile"),
    tag: modelClient("tag"),
    presetTag: modelClient("presetTag"),
    vote: modelClient("vote"),
    comment: modelClient("comment"),
    report: modelClient("report"),
    downloadEvent: modelClient("downloadEvent"),
    auditLog: modelClient("auditLog"),
    async $transaction(ops: Promise<unknown>[]): Promise<unknown[]> {
      const results: unknown[] = [];
      for (const op of ops) results.push(await op);
      return results;
    },
    async $queryRaw(): Promise<unknown[]> {
      return [{ ok: 1 }];
    },
    $disconnect: async () => undefined,
  },
  reset(): void {
    for (const model of MODELS) tables[model].splice(0, tables[model].length);
  },
  seed(model: Model, data: Row): Row {
    const row = DEFAULTS[model](data, new Date());
    tables[model].push(row);
    return row;
  },
};
