# GuitarHub progress log

Status tracking for the phased build defined in `README.md`. One section per completed phase.

## Phase 1 — Foundation ✅

Monorepo (npm workspaces), PostgreSQL 16 schema + migrations, pedal catalog seed data, Express 5 + Prisma API skeleton with RFC 9457 `application/problem+json` errors, Next.js 16 / Tailwind 4 web shell, Docker Compose (postgres, minio, api, web, caddy), CI-ready unit tests (63).

- `apps/api/prisma/schema.prisma` + migrations + idempotent seed (`npm run db:seed`)
- `apps/api/src/errors/problem.ts` — unified error → problem+json mapping
- `apps/web` shell with API health status banner + phase list
- Test convention established: vitest + supertest, Prisma mocked per test file (`apps/api/src/test/fake-prisma.ts`)

## Phase 2 — Auth & accounts ✅

Register, login/logout, email verification, password forgot/reset/change, session rotation + reuse detection, refresh-token rotation, TOTP 2FA with recovery codes, OAuth sign-in + account linking (Google/GitHub), self-profile, session management, step-up re-auth, account deletion. Full web UI: sign-in, register, forgot/reset password, email verification, settings (profile / security / sessions / danger), legal pages.

### Security model (SRS §6)

- Passwords: argon2id (`@node-rs/argon2`, m=64MiB t=3 p=4), timing burn on unknown accounts (uniform `INVALID_CREDENTIALS`)
- Sessions: opaque random session id in HttpOnly cookie (`gh_session`, `__Host-` prefixed when `COOKIE_SECURE`), refresh token cookie (`gh_refresh`, path-scoped to `/api/v1/auth`) with rotation + `usedHashes` replay detection → revoke family + audit `auth.session_reuse_detected`; idle 7d / absolute 30d / step-up 5 min
- CSRF: SameSite=Lax + Origin check for unsafe methods (no Origin header allowed)
- Rate limiting: in-memory fixed window (login 10/15m, register 5/h, reset 5/15m, tokens 10/15m, 2FA 10/15m)
- 2FA: TOTP (`otplib`), one-shot hashed recovery codes; enabling rotates the session
- OAuth: PKCE + state (Google) / state (GitHub) in HttpOnly cookies; no auto-link on email collision (`error=oauth_email_taken`); linking via `POST /auth/oauth/:provider/link` (CSRF-protected)
- Step-up re-auth for email change, 2FA disable, account deletion (password or TOTP within 5 min)
- Emails: `nodemailer` when `SMTP_URL` is set, otherwise in-memory dev outbox (logged with body at debug level when NODE_ENV !== production)
- Account deletion: anonymize or remove presets, cascade revoke sessions/identities/tokens
- New endpoint added during the phase: `POST /auth/password/change` (keeps current session, revokes others)

### Files

- API: `apps/api/src/config.ts`, `app.ts`, `index.ts`, `middleware/auth.ts`, `routes/auth.ts`, `routes/oauth.ts`, `routes/me.ts`, `lib/{tokens,password,totp,mailer,audit,rate-limit,schemas,session,users,mail-tokens,oauth}.ts`, `jobs/purge-deleted.ts`, `test/fake-prisma.ts`
- Migration: `apps/api/prisma/migrations/20261008090000_phase2_auth` (applied to dev DB)
- Web: `apps/web/src/lib/api.ts`, `lib/step-up.ts`, `components/{ui,site-header,auth-nav}.tsx`, `components/settings/{profile,security,sessions,danger,step-up}.tsx`, pages `login`, `register`, `forgot-password`, `reset-password`, `verify-email`, `settings`, `legal/terms`, `legal/community-guidelines`
- Web dev deps added: `qrcode`, `@testing-library/user-event`

### Verification

- `npm run lint` — clean (both workspaces)
- `npm run typecheck` — clean (both workspaces)
- `npm test` — **247 passing** (API 199, web 48)
  - Phase 2 unit-test expansion: API +75 (session lifecycle/rotation/step-up stamps, mail tokens, mailer transport, OAuth PKCE/state/exchange/profile, auth middleware incl. CSRF + step-up, purge job, OAuth route callbacks) and web +27 (`step-up.attempt`, register/forgot/reset/verify pages, sessions & profile sections incl. step-up retry)
- `npm run build -w web` — production build OK, 10 routes
- Live smoke against dev DB: register → profile → 2FA → login±totp → refresh rotation + replay detection → recovery code → password forgot/reset → sessions → sign-out-all → delete; all API flows PASS

### Notes / deferred

- Gear editing UI deferred to Phase 3 (needs pedal catalog API `/pedals`); API already accepts `gear` on `PATCH /me`
- OAuth providers are opt-in via env vars (no real Google/GitHub credentials during dev)
- `npm audit` reports 5 high-severity advisories in the web dev toolchain (`eslint-config-next` → `braces`) — address in Phase 7 hardening
- SMTP delivery is not configured; dev relies on the in-memory outbox (reset/verify links logged at debug level)

## Phase 3 — Pedal catalog API + preset upload pipeline ✅

Pedal catalog endpoints, S3/MinIO or local object storage with pre-signed PUTs, per-format server-side validators, quarantine → publish flow, and Quad Cortex cloud links. Web UI: pedal list, pedal detail, upload wizard (multi-file, draft/publish, per-pedal behavior).

- `GET /pedals` / `GET /pedals/:slug` — enabled catalog + published preset counts
- `POST /presets/upload-url` — extension allowlist → size cap (primary/bundle/companion per pedal) → HMAC-signed (local) / S3 pre-signed PUT; key bound to `quarantine/:userId`
- `POST /presets/inspect` — validate + extract metadata (deep JSON ≤64 nesting, sysex magic per brand, fixed-binary, shallow), SHA-256 content hash, duplicate detection; rejects foreign quarantine keys (403)
- `POST /presets` — re-validates every file, moves objects into immutable `presets/:id/v1/{primary|ir-N}.ext`, duplicate rejection unless `forkAck`, creates preset + `PresetFile` rows + `PresetTag` links, audit `preset.create`; draft & published
- Validators (`lib/validators.ts`): `DEEP_JSON` / `SYSEX` (Fractal `00 01 74`, Zoom `52`) / `FIXED_BINARY` (Valeton 1224-byte TSRP) / `SHALLOW`; IR allowlist (wav → RIFF/WAVE, hir, syx); masquerade rejection (PDF/ELF/ZIP/gzip/HTML) — NFR-5
- Cloud links: `validateCloudLink` — strict `https`, no userinfo/port, **exact host allowlist** (`cloud.neuraldsp.com`), server never fetches (anti-SSRF)
- Storage (`lib/storage.ts`): `local` driver (dev, signed tokens, on-disk `STORAGE_LOCAL_DIR`) + `s3` driver (MinIO/AWS, pre-signed PUT + copy/delete on move); both implement `presignPut/get/move/remove`; rate limits per SRS §6.7 (upload-url & inspect 30/h, publish 10/h)

### Files

- API: `routes/{pedals,presets,storage-local}.ts`, `lib/{storage,validators}.ts`, `config.ts` (storage env), `app.ts` (route mounts)
- Web: `app/pedals/page.tsx`, `app/pedals/[slug]/page.tsx`, `app/upload/page.tsx` (+ tests), `components/site-header.tsx`
- Web deps: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`

### Verification

- `npm run lint` — clean (both workspaces)
- `npm run typecheck` — clean (both workspaces)
- `npm test` — **335 passing** (API 275, web 60; +76 API, +12 web this phase)
- `npm run build -w web` — production build OK, **13 routes**
- Live smoke against dev DB (20 checks all PASS): register → catalog counts (`presetCount` 0→1 after publish) → extension rejection (`.exe` → `FILE_EXTENSION_NOT_ALLOWED`) → QC `upload-url` → `CLOUD_LINK_REQUIRED` → pre-signed PUT → inspect extracts `title/device/firmwareVersion` → magic-mismatch rejection → foreign-key 403 → publish with files+tags → duplicate `409 DUPLICATE_CONTENT` w/o `forkAck` → cloud-link publish + host allowlist rejection → draft save → anon 401

### Notes / deferred

- GET/PATCH/DELETE on presets and the download endpoint are Phase 4 (browse/download) work
- Local-driver pre-signed URLs point at `APP_URL` — the web dev proxy (`/api` → API) serves the PUT; direct API smoke used the API origin
- `npm audit` still reports 5 high-severity advisories in the web dev toolchain — deferred to Phase 7 hardening

## Phase 4 — Browse, search & download ✅

Public preset browsing with cursor pagination and filters, Reddit-style hot ranking, detail pages, download with rate limits + dedup, tag autocomplete, and the home feeds.

- `GET /presets` — published-only list; post-filter in code (`pedal`, `section`, `tag`, `q`, `usesIr`, `verified`); `q` matches title/description/song/artist/tag/uploader; batch-computed `counts` inline per preset; sorts `hot` (read-time Reddit formula per FR-4.3), `new`, `top`, `downloads`, `comments`; cursor = last preset id → `nextCursor`, bad cursor → `400 INVALID_CURSOR`
- `GET /presets/:id` — full metadata + `counts`, `firmwareWarning` (signed-in gear firmware mismatch), `mine` for owner; increments `viewCount`; drafts 404 unless owner
- `GET /presets/:id/download` — authed `download:<userId>` 100/h, anon 30/h; always `downloadCount++`; `DownloadEvent` unique `[presetId, clientKey, day]` → once/day per user or anon hash of IP+UA; `cloud_link` → 302 `cloudUrl`, `FILE` → `presignGet` → 302; `Cache-Control: no-store`
- `GET /tags` — public tag list (browse tag filter)
- Storage: `presignGet` added to `ObjectStorage` (local → HMAC `GET /storage/local/download/:token` streaming with ETag/`no-sniff`, s3 → presigned GET + RFC 6266 `attachmentDisposition`); `verifyToken` now codes expired tokens distinctly (`UPLOAD_TOKEN_EXPIRED` / `DOWNLOAD_TOKEN_EXPIRED`)
- Migration `20261008092000_phase4_search` — pg_trgm GIN trigram indexes (Preset title/song/artist, Tag label, User displayName) + `DownloadEvent` lookup index
- fake-prisma extended: `vote` / `comment` / `report` / `downloadEvent` models, `contains` / `endsWith` operators, top-level `OR`/`AND`/`NOT`, `increment`/`decrement`, unique-key exclusion fixed on `update`
- Web: browse page `/presets` (search + pedal/section/tag/sort/usesIr/verified filters, "Load more" cursor paging), detail page `/presets/[id]` (firmware + third-party-IR warnings, stats grid, song/album block, import instructions, download or open-in-cloud), home feeds (trending / newest / pedals quick nav + search box), site header "Browse" link, pedal detail "Community presets" section

### Files

- API: `routes/{presets,tags,storage-local}.ts`, `lib/storage.ts`, `test/fake-prisma.ts`, `prisma/migrations/20261008092000_phase4_search`
- Web: `app/presets/page.tsx` (+test), `app/presets/[id]/page.tsx` (+test), `app/page.tsx` (+test rewritten to feeds), `components/home-feeds.tsx`, `components/site-header.tsx`, `app/pedals/[slug]/page.tsx` (presets section), `lib/api.ts` (preset types + `listPresets`/`getPreset`)

### Verification

- `npm run lint` — clean (both workspaces)
- `npm run typecheck` — clean (both workspaces)
- `npm test` — **376 passing** (API 304, web 72; +29 API, +12 web this phase)
  - Phase 4 unit tests: browse list/detail/download, tag endpoint, `attachmentDisposition`, download tokens (invalid/expired codes), local `presignGet` + streaming route headers, authed 100/h + anon 30/h download limits, per-user once/day dedupe, browse/detail/home/pedal-detail UI flows
- `npm run build -w web` — production build OK, **15 routes** (+`/presets`, `/presets/[id]`)

### Notes / deferred

- `q` search uses the prisma `contains` indexes in migration 4; SQLite test fake runs an in-memory equivalent — wire Postgres `to_tsvector` full-text if result quality becomes an issue
- Anonymous `clientKey` hashes IP+UA (no cookie yet); revisit if anon rate limits need stability across rotating IPs
- Tag browse uses the seeded catalog tags; user-defined tag governance remains Phase 6

## Phase 5 — Votes, comments & hot ranking ✅

Votes (±1 toggle), threaded comments with sanitized Markdown, Reddit-style hot ranking persisted as a cached `hotRank` (SRS FR-4, §7.3.4), and content reporting.

### API (SRS FR-4)

- `PUT /presets/:id/vote` — body `{value: 1|0|-1}`; auth + 60/h; published only, own preset → `403 VOTE_OWN_PRESET`; `0` removes; done via `findFirst → updateMany/deleteMany` (Vote is `@@id([userId, presetId])`); recomputes + persists `Preset.hotRank`; returns `{counts, userVote}`; `GET /presets/:id` now exposes `userVote` for the current viewer
- `GET /presets/:id/comments` — published only; top-level newest-first with cursor paging; one level of replies (asc) nested under each; soft-deleted rows render as tombstones (author/body null)
- `POST /presets/:id/comments` — auth + 20/h; account must be ≥10 min old (`ACCOUNT_TOO_NEW`); parent must be a non-deleted top-level comment on this preset (`COMMENT_PARENT_INVALID`, max depth 2); link count ≤4 (`COMMENT_TOO_MANY_LINKS`); body render + html stored with `bodyHtmlVersion`
- `PATCH /comments/:id` — author only (`COMMENT_NOT_OWNED`), edits within 15 min (`COMMENT_EDIT_WINDOW`); re-renders Markdown, sets `editedAt`
- `DELETE /comments/:id` — author or ADMIN; soft delete (tombstone), keeps replies
- `POST /reports` — auth + 20/day; `targetType preset|comment` + reason 10–1000 chars; verifies target exists (`REPORT_TARGET_NOT_FOUND`); one open report per reporter+target (`REPORT_DUPLICATE`); returns `{status: "open"}`
- New `lib/markdown.ts` — dependency-free strict renderer/sanitizer: HTML-escapes first, allowlist-only output (`p,br,strong,em,del,code,pre,a,ul,ol,li,blockquote,h1–h6`), http(s)-only links (unsafe schemes collapse to their label), link counting for the spam limit; `MARKDOWN_VERSION` gates re-rendering on read; full unit tests
- New `lib/hot-rank.ts` — `hotScore` moved here (shared by list read-time sort + persistence); `refreshPresetHotRank(id)` and `refreshAllHotRank()` worker; `jobs/refresh-hot-rank.ts` ticks every 5 min (started with the purge job in `index.ts` when not `test`)
- Migration `20261008100000_phase5_engagement` — `Comment.bodyHtmlVersion` (+ `Comment(presetId,parentId)` and `Report(reporterId,status)` indexes); applied to dev DB via `prisma migrate deploy`
- fake-prisma: `comment`/`report` defaults (incl. `bodyHtmlVersion`, `status OPEN`) — Vote handled with `findFirst` + `updateMany`/`deleteMany` (no compound-key `findUnique` support needed)

### Web

- `components/preset-vote.tsx` — ▲/▼ toggle widget (aria-pressed), live score/up/down refresh, own-preset notice, sign-in prompt for guests, 401-aware errors; wired into the detail page "Rating" cell
- `components/preset-comments.tsx` — thread list + composer (Markdown hint, char count, link-safe rendered HTML), one-level replies, edit within window, soft-delete tombstones, report flow; sorts into `presets/[id]/page.tsx` with `getCurrentUser()` viewer passed down
- `lib/api.ts` — `votePreset`, `listComments`, `postComment`, `updateComment`, `deleteComment`, `reportContent`, comment types; `PresetDetail.userVote`

### Tests

- API `routes/engagement.test.ts` (votes, comments, reports) + `lib/markdown.test.ts` + new `lib/hot-rank.test.ts` (FR-4.3 math, cached-rank worker) + `lib/comments.test.ts` (re-render gate, tombstone serialization) — **API suite now 341 passing** (+37 this phase)
- Web: `preset-vote.test.tsx`, `preset-comments.test.tsx`, detail-page suite extended for vote widget + comments fetch — **web suite now 81 passing** (+9)
- Migration confirmed against live dev Postgres (`prisma migrate status`/`deploy`)
- `npm run lint`, `npm run typecheck`, `npm run build -w api` all clean

### Notes / deferred

- Barrier between anonymous and vote/comment: 401 from `GET /me` drives guest UI; `getCurrentUser` already coerces 401/403 → null (404 rethrows, which is correct — `/me` never 404s)
- `hotRank` is written additively on vote and by the 5-min worker; read-time hot sort still computes exactly (tests rely on it), so cached column is purely a pre-computed feed backstop
- Reports have no moderation surface yet — queue/review UI is Phase 6 (Status OPEN documented in `ReportStatus`)
- Markdown renderer intentionally minimal (no tables/autolinks/HTML); swap for `marked`+`sanitize-html` behind the same `MARKDOWN_VERSION` bump if richer formatting is wanted

## Phase 6 — Admin & moderation ✅

Administrator console (SRS FR-7): pedal catalog CRUD, moderation queue for reports, platform stats, and tag governance (rename/merge/blacklist). Gated by a shared `requireAdmin` middleware.

### API (SRS FR-7)

- New `middleware/admin.ts` — `requireAdmin` (401 unauthenticated → 403 `ADMIN_REQUIRED`; banned → 403 `ACCOUNT_BANNED`); `adminRouter` mounted at `/api/v1/admin`, all routes behind it
- Pedals: `GET /admin/pedals` (serialized with published `presetCount`), `POST /admin/pedals` (`brand`+`model` → slug `slugify(brand)-slugify(model)`; 409 `PEDAL_SLUG_TAKEN`), `PATCH /admin/pedals/:id` (partial; 404 `PEDAL_NOT_FOUND`)
- Reports: `GET /admin/reports` — `status` filter (default `open`), `page`/`limit` (≤50), enriched `target` (`preset`/`comment` + owner) and `reporter`, plus `counts` per status; `POST /admin/reports/:id/resolve` — `action: dismiss|hide|remove` + optional `note` (step-up required; 404 `REPORT_NOT_FOUND`, 409 `REPORT_ALREADY_HANDLED`, 404 `REPORT_TARGET_NOT_FOUND`)
- Users: `POST /admin/users/:id/ban` (`type: hard|shadow` + `reason`, step-up) and `POST /admin/users/:id/unban` (step-up). HARD revokes all active sessions; SHADOW hides the user's `PUBLISHED` presets (`statusReason: "Shadow banned: …"`). Guards: 404 `USER_NOT_FOUND`, 409 `USER_ALREADY_BANNED`, 409 `USER_NOT_BANNED`, 400 `CANNOT_BAN_SELF`, 403 `CANNOT_BAN_ADMIN`
- Stats: `GET /admin/stats` — users (total/verified/30d), presets by status, downloads (total + tracked events), storage (bytes/files), engagement (comments/votes/open reports), per-pedal published+downloads table, recent signups
- Tags: `GET /admin/tags` (with per-tag `presetCount`), `POST /admin/tags`, `PATCH /admin/tags/:id` (slug/label rename, or `blacklisted: true` → step-up, detaches the tag from all presets and returns `detached` count), `POST /admin/tags/:id/merge` (step-up; moves presets to target, deletes source). Codes: 409 `TAG_SLUG_TAKEN`, 404 `TAG_NOT_FOUND`/`TAG_TARGET_NOT_FOUND`, 400 `TAG_MERGE_SELF`
- Blacklisted tags are rejected at upload: `resolveTags` in `routes/presets.ts` throws 400 `TAG_BLACKLISTED`; public `GET /tags` filters `where: { blacklisted: false }`
- Schema: `Tag.blacklisted Boolean @default(false)`; migration `20261008110000_phase6_admin` — **applied to dev DB via `prisma migrate deploy`**
- Every admin write emits an `audit(...)` row; `P2002` is caught locally and surfaced as 409 (Prisma's unique error carries no HTTP status)

### Web

- `components/admin-gate.tsx` — role gate (401 → sign-in prompt, non-admin → 403 notice) wrapping an admin sub-nav (Overview/Reports/Pedals/Tags); an "Admin" link now appears in `auth-nav.tsx` for `role === "ADMIN"`
- `app/admin/page.tsx` — stats dashboard (cards, per-pedal table, recent signups; exports `formatBytes`)
- `app/admin/reports/page.tsx` — status tabs with counts, moderator note + step-up password, Dismiss/Hide/Remove + "Ban <owner>" actions
- `app/admin/pedals/page.tsx` — catalog list with inline enable/disable + edit, and an add-pedal form
- `app/admin/tags/page.tsx` — create/rename/blacklist/merge with detached-count feedback
- `lib/api.ts` — admin client: `listAdminPedals`, `createAdminPedal`, `updateAdminPedal`, `listAdminReports`, `resolveAdminReport`, `banUser`, `unbanUser`, `getAdminStats`, `listAdminTags`, `createAdminTag`, `updateAdminTag`, `mergeAdminTags` + related types

### Tests

- API `routes/admin.test.ts` (42: access control incl. `ACCOUNT_BANNED`, pedal CRUD + slug collision, moderation queue incl. vanished targets/invalid action/remove/hide, ban/unban edges, stats, tag governance incl. 404s + step-up matrix) + `routes/presets.test.ts` blacklist-guard test + `routes/tags.test.ts` public blacklist filter — **API suite now 385 passing** (+44 this phase)
- Web: `admin-gate.test.tsx`, `app/admin/page.test.tsx`, `app/admin/reports/page.test.tsx` (tab switch + 409 error surface), `app/admin/pedals/page.test.tsx` (create/edit/enable), `app/admin/tags/page.test.tsx` (create/rename/blacklist/merge/badge), `auth-nav.test.tsx` (admin link shown only for `ADMIN`) — **web suite now 104 passing** (+23)
- `npm run lint`, `npm run typecheck`, `npm run build -w api` / `-w web` (24 routes incl. `/admin`, `/admin/pedals`, `/admin/reports`, `/admin/tags`) all clean
- Migration confirmed against live dev Postgres (`prisma migrate status` → all applied)

### Notes / deferred

- Admin pages load data via an inline `useEffect` + `.then/.catch` (setState only in callbacks) to satisfy the `react-hooks/set-state-in-effect` lint rule; post-mutation reloads use a plain `refresh()` called from event handlers
- Step-up is satisfied by a fresh session `stepUpAt` (≤5 min) or a `password`/`totp` in the body — the admin UI exposes a shared "Confirm password" field for lapsed windows
- Admin console is client-gated only; the API is the real boundary (`requireAdmin` on every route). Fine-grained moderator roles (beyond `USER|ADMIN`) remain out of scope

## Integration testing - Phases 1-6 ✅

End-to-end suite driving the real API over HTTP against the live PostgreSQL dev DB (no mocks — unit tests keep using fake-prisma). `apps/api/scripts/integration.ts` (`npm run test:integration`, root or `apps/api`; `BASE_URL` targets another origin, `--keep` skips cleanup).

- **76 checks**: Phase 1 health/catalog/tags (incl. migration `20261008092000_phase4_search` applied + 28 pedals / 15 tags seeded), Phase 2 register/dup/weak-pw/login/logout/sessions/PATCH gear/password rotation, Phase 3 presigned PUT → inspect (sha256 + extracted meta) → publish, duplicate `409`, ext/size/garbage rejections, QC `CLOUD_LINK_REQUIRED`, cloud-link host allowlist, `TAG_UNKNOWN` before write, draft save, Phase 4 list visibility (anon vs owner draft), pedal/section/tag/usesIr/`q` filters, `sort=new` newest-first, cursor pagination disjoint + `INVALID_CURSOR`, detail view counter + `firmwareWarning` against saved gear, byte-exact download + attachment name, `DownloadEvent` once/day dedupe (verified via Prisma), authed vs anon event keys, cloud 302 to exact URL, anon 30/h and register 5/h rate limits → `429 RATE_LIMITED`
- **Phase 5 (15)**: `ACCOUNT_TOO_NEW` gate on a fresh member, sanitized Markdown comment (`<em>` kept, `<script>` stripped), one-level replies with `COMMENT_PARENT_INVALID` on deeper nesting, `COMMENT_TOO_MANY_LINKS`, thread top-level + nested reply listing; vote up/down/clear counts + `userVote` + `VOTE_OWN_PRESET`, cached `hotRank` rises on upvote (verified via Prisma), detail `counts.comments`/`userVote` (member vs anon); report preset, `REPORT_DUPLICATE`, anon 401 / `REPORT_TARGET_NOT_FOUND` / short-reason 400
- **Phase 6 (15)**: anon 401 + member `ADMIN_REQUIRED`, moderator promoted via Prisma, `GET /admin/stats` + `/admin/pedals` (per-pedal counts), pedal create/slug-derive/`PEDAL_SLUG_TAKEN`/update, reports queue enrichment (target owner/title + reporter + counts), dismiss keeps preset `PUBLISHED` + `REPORT_ALREADY_HANDLED`, step-up gate (`STEP_UP_REQUIRED`) before hide, hide marks `HIDDEN` + `statusReason` + 404 publicly + shows in `status=resolved`, tag create/blacklist (hidden from public `GET /tags`)/merge (source deleted), hard ban revokes sessions + unban restores login
- Auto-cleanup after every run: users/presets/audit rows deleted (cascades), local `.local-objects` files removed, created pedals + tags removed; suite is idempotent (unique per-run titles/emails)
- **Run 3 (API-direct, `APP_URL=http://localhost:4000`, migrations `20261008100000_phase5_engagement` + `20261008110000_phase6_admin` applied): 76/76 pass** — extends the previously verified Phase 1-4 46-check runs to engagement + admin/moderation
- **Earlier: Run 1 (API-direct, `APP_URL=http://localhost:4000`): 46/46 pass. Run 2 (full stack through the Next.js proxy, `BASE_URL=http://localhost:3000/api/v1`, `APP_URL=:3000`): 46/46 pass** — validates cookie pass-through, raw-body proxying of the presigned PUT, and presigned URLs on the web origin
- **Bug found & fixed**: `sortPresets` compared `Number(new Date(String(createdAt)))` — `String()` on a Prisma `Date` drops milliseconds, so presets created in the same second tied and sorted arbitrarily (integration `sort=new` failed once, passed by luck the run before). Fixed with a `ts()` helper using `Date.getTime()` for real `Date`s (all five sort comparators); API unit tests 304/304 still pass
- Fixed: every `429 RATE_LIMITED` now advertises RFC 6585 `Retry-After`. `ApiError` gained optional `headers` (applied by `errors/problem.ts`), and a shared `rateLimited(result, message)` guard in `lib/rate-limit.ts` throws with `Retry-After` — used by auth's `limited()` (no longer plumbs `res`), and the local helpers/inline checks in `routes/{presets,comments,reports}.ts` that previously omitted it. Unit tests now assert `retry-after` on the upload/inspect + anon/authed download 429s; API suite still 385 passing + 76/76 integration.
- Note: rate-limit buckets are in-memory — restart the API between integration runs (fresh `register:` / `download:anon:` counters)
- Verification: `npm run lint` / `npm run typecheck` clean, `npm test` **489** (API 385, web 104), both server logs show zero errors during the runs

## Phase 7 — UI polish, accessibility, testing, deployment hardening ✅

Accessibility remediation to WCAG 2.1 AA core flows (SRS NFR-7/§2.10), the deferred gear-editing UI, a11y + editor tests, and deployment hardening (SRS §6.5/NFR-8).

### Accessibility (SRS NFR-7)

- New `components/skip-link.tsx` — hidden-until-focused "Skip to content" link (`sr-only focus:not-sr-only`) jumping to `#main`; `app/layout.tsx` renders it and wraps children in `<div id="main">` (bypass block 2.4.1)
- `app/globals.css` — `:focus-visible` outlines for links/buttons/tab roles (2.4.7) and a `prefers-reduced-motion` suppression block (2.3.3)
- `components/ui.tsx` — `Button` sets `aria-busy` while pending; `site-header.tsx`/`auth-nav.tsx` navs get `aria-label` ("Primary", "Account")
- `app/settings/page.tsx` — real ARIA tablist: `role=tablist/tab/tabpanel`, `aria-selected`, `aria-controls`/`aria-labelledby`, roving `tabIndex` (0/-1) and ArrowLeft/Right/Home/End keyboard traversal (2.1.1)

### UI polish — gear editor (deferred since Phase 2/3)

- `components/settings/profile.tsx` — new "Pedal gear" block: loads the member's gear via `getMyGear()` (`GET /me`), a pedal picker fed by `listPedals()` (`GET /pedals`) with an optional firmware input, per-row firmware edit + remove, duplicate-pedal guard, "Unsaved changes" hint; `gear` is only sent on `PATCH /me` when the list was actually edited, and gear state is refreshed from the response
- `lib/api.ts` — added `getMyGear`, `listPedals`, and hoisted a shared `PedalSummary` type (previously exported from `app/pedals/page.tsx`; upload/presets pages now import it from `lib/api`)
- `app/pedals/page.tsx` now uses the shared `listPedals()` helper

### Tests (+7 → web 111)

- Gear editor: loads saved gear + persists firmware edits, adds a pedal from the catalog (PATCH body includes it), removes gear before save
- `components/skip-link.test.tsx` — href/link text + sr-only behavior
- `app/settings/page.test.tsx` — tablist roles + roving `tabIndex`/`aria-selected`, Arrow keys + Home/End move selection and focus, wrap-around at both ends
- Existing profile/step-up tests reworked to route per-request fresh responses (an in-memory `useFetch`-style mount now fetches gear, so shared mocked `Response` bodies were being read twice; per-call `mockApi()` mirrors real network behavior)

### Deployment hardening (SRS §6.5, NFR-8)

- `docker-compose.yml` — api env now carries the full production surface (`APP_URL`, `COOKIE_SECURE`, `TRUST_PROXY`, `TOS_VERSION`, OAuth + SMTP passthrough, `HIBP_CHECK`, S3 storage pointed at MinIO with credentials from `MINIO_*`); `healthcheck`s added for api (`/api/v1/health`) and web (`/`); `depends_on` chain requires `service_healthy` (postgres → api → web → caddy)
- `deploy/Caddyfile` — full header set added: `Cross-Origin-Opener-Policy same-origin`, `Cross-Origin-Resource-Policy same-origin`, and a base `Content-Security-Policy` (`default-src 'self'`, `base-uri 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'`, restricted `script-src`/`style-src`/`img-src`/`font-src`/`connect-src`). **Caveat**: Next.js ships small inline bootstrap scripts, so `script-src` keeps `'unsafe-inline'`/`'unsafe-eval'` here; a per-request nonce CSP is the documented follow-up. A commented production TLS template (automatic HTTPS + HSTS) is included
- `apps/api/Dockerfile` + `apps/web/Dockerfile` — run stages now run as a non-root `app` user (`adduser`/`USER app`), api stage keeps a writable `.local-objects` dir (NFR-8 least privilege)
- `.env.example` — documented production overrides (`APP_URL`, `COOKIE_SECURE`, `TRUST_PROXY`, SMTP/OAuth, `STORAGE_*`, `HIBP_CHECK`); `.dockerignore` excludes `*.log` and docs

### npm audit (Phase 2/3 deferral, now resolved/assessed)

- `npm audit fix` cleared the critical `shell-quote` advisory (transitive via `concurrently`) — 0 critical, 0 moderate/low remain
- **8 high remain, all in dev/build tooling with no non-breaking fix** (accepted, documented):
  - `braces`/`micromatch`/`fast-glob`/`@next/eslint-plugin-next`/`eslint-config-next` chain (ESLint tooling only — never shipped)
  - `deepmerge-ts`/`@prisma/config`/`prisma` 6.19.3 CLI chain (listed even with `--omit=dev`; the generated `@prisma/client@6.19.3` runtime is **not** flagged)
- Environment note: `apps/web` is a standalone npm project (it owns `apps/web/package-lock.json` while `eslint-config-next` hoists to the root), so `next@16.4.0` was provisioned at the root via `npm install --no-save next@16.4.0` so the hoisted parser can resolve `next/dist/compiled/babel/eslint-parser`. Re-run that (or `npm install` inside `apps/web`) if a root `npm install` prunes it and web lint reports the missing parser again

### Verification

- `npm run lint` — clean (both workspaces)
- `npm run typecheck` — clean (both workspaces)
- `npm test` — **496 passing** (API 385, web 111; +7 web this phase)
- `npm run build -w api` — tsc build clean; `npm run build -w web` — production build OK (19 route entries, SSG + Partial Pre-rendering)
- `npm run test:integration` — **Run 4 (fresh API server, `APP_URL=http://localhost:4000`): 76/76 pass** — confirms the earlier RESTART the API caveat still holds (stale in-memory rate-limit buckets from prior runs caused a 429-failed re-run; a fresh server restored 76/76) and re-validates the `PATCH /me` gear path end to end