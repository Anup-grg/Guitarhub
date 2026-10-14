# Software Requirements Specification (SRS)

## GuitarHub — Community Preset Sharing Platform for Multi-Effects Pedals

|                         |                                      |
| ----------------------- | ------------------------------------ |
| **Document version**    | 1.0                                  |
| **Date**                | 2026-10-06                           |
| **Status**              | Draft for review                     |
| **Intended readership** | Product owner, developers, reviewers |

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Supported Pedals & File Formats](#2-supported-pedals--file-formats)
3. [Overall Description](#3-overall-description)
4. [Functional Requirements](#4-functional-requirements)
5. [Non-Functional Requirements](#5-non-functional-requirements)
6. [Authentication & Security Requirements](#6-authentication--security-requirements)
7. [System Architecture](#7-system-architecture)
8. [Data Model](#8-data-model)
9. [API Surface (Outline)](#9-api-surface-outline)
10. [Feasibility Study](#10-feasibility-study)
11. [Risk Register](#11-risk-register)
12. [Out of Scope / Future Phases](#12-out-of-scope--future-phases)
13. [Appendix A — File Format Reference](#appendix-a--file-format-reference)
14. [Appendix B — Glossary](#appendix-b--glossary)

---

## 1. Introduction

### 1.1 Purpose

GuitarHub is a web platform where guitarists upload, share, discover, and download
**preset files for guitar multi-effects pedals**. Presets are categorized by _pedal model_
and, within each pedal, by **section** — a general section and a songs section. Community
members rank presets via **upvotes** and **comments**.

This document specifies the requirements for the first production release (v1.0) and
includes a feasibility study.

### 1.2 Scope

- User registration, authentication, and profile management
- Preset upload with metadata, validation, and categorization
- Browsing, filtering, and full-text search of presets
- Upvote/downvote ranking and comment threads
- Fast, direct download of preset files
- Administration tools (content moderation, pedal catalog management)

### 1.3 Definitions

| Term                         | Definition                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Preset / Patch**           | A named configuration of an effects pedal (signal chain + parameters), stored as a file in the pedal's proprietary format |
| **Section**                  | Top-level grouping inside a pedal category: `General` or `Songs`                                                          |
| **Pedal**                    | A specific multi-effects processor model (e.g. Line 6 Helix LT)                                                           |
| **Firmware**                 | The pedal's OS version; presets may be incompatible across versions                                                       |
| **IR**                       | Impulse Response — a cabinet-simulation file often required by a preset                                                   |
| **Capture / Neural Capture** | Quad Cortex term for a captured hardware device profile                                                                   |
| **SysEx**                    | MIDI System Exclusive — the binary transport format used by several pedals                                                |

---

## 2. Supported Pedals & File Formats

> **Research note:** Formats below were verified against vendor documentation, editor
> software guides, and community tooling (see Appendix A sources). Vendor formats are
> **proprietary and undocumented**; the site must validate files at a shallow level
> (extension + magic bytes + size) and must **not** attempt to fully parse content
> except where noted as "deep validation possible".

### 2.1 MVP pedal matrix

| #   | Brand                | Models (MVP)                                                                 | Preset file extension(s)                                                                        | Underlying format                                                                                              | Validation depth                                                                             |
| --- | -------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | **Line 6**           | Helix, Helix LT, Helix Rack, HX Stomp, HX Stomp XL, HX Effects, Helix Native | `.hlx` (preset), `.hls` (setlist)                                                               | **Plain JSON** (schema `L6Preset`, version field, `data.device`, packed firmware version)                      | **Deep** — parse JSON, verify schema/version/device, read preset name & firmware server-side |
| 2   | **Line 6 (new gen)** | Helix Stadium family                                                         | `.hsp` (preset), `.hss` (setlist)                                                               | JSON-family (new schema)                                                                                       | Deep (same as above, different schema)                                                       |
| 3   | **Fractal Audio**    | Axe-Fx III, FM9, FM3, Axe-Fx II                                              | `.syx` (preset), `.fasBundle` (preset + cabs)                                                   | MIDI SysEx binary; header magic `F0 00 01 74 <productId>`                                                      | Medium — SysEx header/terminator check, size bounds                                          |
| 4   | **Neural DSP**       | Quad Cortex                                                                  | **No local file format** — distribution is via **Cortex Cloud** only                            | Cloud account sharing                                                                                          | N/A — see §2.3 special handling                                                              |
| 5   | **Boss**             | GT-1000, GT-1000CORE, GT-1, GT-1B (and future GT models)                     | `.tsl` (Tone Studio liveset)                                                                    | Binary/XML liveset exported by BOSS TONE STUDIO                                                                | Shallow — extension + size + per-model allowlist                                             |
| 6   | **Flamma**           | FX-200, FX-150                                                               | `.pfl`                                                                                          | Proprietary binary (Flamma editor)                                                                             | Shallow — extension + size                                                                   |
| 7   | **Zoom**             | G5n, G3n, G3Xn, G1 Four/G1X Four, MS-50G                                     | `.zptc` (Guitar Lab patch); MS-series also shared as SysEx dumps                                | Guitar Lab patch container; SysEx for MS series                                                                | Medium for SysEx (`F0 52 …F7`), shallow for `.zptc`                                          |
| 8   | **NUX**              | MG-30, MG-400 (MG-300 optional)                                              | QuickTone™ export files (community files observed as `.mg30patch`, `.mg400patch`, `.nuxpreset`) | Proprietary binary                                                                                             | Shallow — extension + size + per-model allowlist                                             |
| 9   | **Valeton**          | GP-200                                                                       | `.prst`                                                                                         | Binary, **exactly 1224 bytes**, magic `TSRP` (reversed "PRST") + device ID `2-PG`, 11 effect blocks × 72 bytes | **Strict** — fixed size + magic check makes spoofing trivial to reject                       |

### 2.2 What can be improved / implementation implications

1. **Deep validation where possible.** `.hlx` is JSON, not a binary blob — the server can
   parse it, reject malformed files, and **auto-extract**: preset name, device ID (Helix vs
   HX Stomp vs …), and firmware version. This removes user-entry errors for the largest
   pedal brand. Implement the same for `.hsp`.
2. **Strict validator for Valeton.** `.prst` has a fixed 1224-byte size and a magic header.
   Reject anything else before it ever reaches storage — near-zero cost, strong guarantee.
3. **SysEx sanity checks for Fractal/Zoom MS.** Verify start byte `F0`, correct
   manufacturer ID (`00 01 74` Fractal; `52` Zoom), terminal `F7`, and a size ceiling.
4. **Quad Cortex cannot be file-hosted (MVP).** Neural DSP provides no local preset file
   export; presets are shared _to a Cortex Cloud username_. v1.0 must support QC as a
   **"cloud-share" preset type**: the upload stores a Cortex Cloud share link/username +
   metadata, and the Download button deep-links to the cloud item (see FR-2.7). A later
   phase can revisit if Neural DSP opens a file format.
5. **Mandatory firmware/version field.** Every upload declares pedal model **and**
   firmware/editor version (e.g. Helix v3.80, CorOS, QuickTone GEN2 vs V5 — NUX GEN2
   firmware is _only_ compatible with GEN2 QuickTone). Displayed prominently on the
   download page. This single field prevents most "it doesn't load" complaints.
6. **IR dependency flag.** Presets that reference third-party IRs (`.wav`/`.syx`) often
   break when shared. Require the uploader to declare "uses third-party IRs" and optionally
   attach them (`.wav`, `.hir`, `.syx`) as companion files (max 2–5 files per preset).
7. **Format allowlist is data, not code.** Store the pedal/format matrix in the database
   (pedal model → extensions → max size → validation mode) so new pedals/firmware can be
   added without a deployment.
8. **Setlists/bundles as a second content type.** `.hls`, `.hxb`, `.fasBundle`, `.tsl`
   contain _many_ presets. MVP: accept them under a "Bundle" type with size cap; do not
   split them server-side.
9. **Zip policy.** Allow `.zip` only as a container for companion files (IRs), never as
   the preset itself; scan archives, reject zip bombs and nested archives.
10. **Maximum file sizes (starting limits, tunable per pedal):** single preset 1 MB
    (typical `.hlx` 10–100 KB, `.prst` 1.2 KB, `.syx` 20–100 KB); bundle 20 MB; companion
    IR files 5 MB each.

### 2.3 Quad Cortex special handling (accepted limitation)

| Option                        | Description                                                                  | MVP decision                             |
| ----------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------- |
| A. Cloud-share link           | Uploader shares preset publicly on Cortex Cloud; site stores link + metadata | **Chosen**                               |
| B. Block QC                   | Exclude the pedal                                                            | Rejected — QC is a major platform        |
| C. Host unofficial file dumps | Reverse-engineered/local backups                                             | Rejected — format not public, legal risk |

QC entries still participate fully in ranking, comments, and search; only the "file"
artifact differs (link vs binary).

---

## 3. Overall Description

### 3.1 User classes

| Persona                      | Needs                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Guest (anonymous)**        | Browse, search, preview metadata, view rankings; no download of some flagged content if we later gate it (v1: downloads open) |
| **Registered guitarist**     | Upload presets, download, upvote/downvote, comment, manage own presets                                                        |
| **Trusted/established user** | Higher rate limits, edit own presets after publish                                                                            |
| **Administrator**            | Manage pedal catalog, moderate content, ban users, view stats                                                                 |

### 3.2 Product principles

1. **Clean design, fast response** — server p95 API latency < 200 ms; downloads served
   from object storage with HTTP caching, not through the app server.
2. **Upload/download speed** — direct-to-storage upload with pre-signed URLs for files
   > 1 MB; downloads via CDN/public bucket with long-lived cache headers + content-hash
   > filenames.
3. **Trust** — strong authentication (§6) and safe file handling (§5.4).

### 3.3 Category structure

```
Pedal (e.g. Line 6 Helix)
├── General          → presets that are general-purpose tones (clean, crunch, lead, ambient…)
│     └── tags: genre, amp type, gain stage, use-case
└── Songs            → presets aimed at a specific song
      └── fields: song title, artist, (album, year optional)
```

- Exactly two sections per pedal (fixed): `general`, `songs`.
- `Songs` uploads require `song_title` + `artist`; `General` uploads require at least one
  tag. Validation differs per section — enforced server-side.
- Search index spans preset name, description, song/artist, tags, pedal, and uploader.

---

## 4. Functional Requirements

### FR-1 — Authentication & accounts

- **FR-1.1** Register with email + password (argon2id hashing, email verification),
  accepting Terms of Service + Community Guidelines (checkbox records policy version +
  timestamp).
- **FR-1.2** Sign in via OAuth 2.0 providers (Google, GitHub, Discord) using Authorization
  Code + PKCE.
- **FR-1.3** TOTP two-factor authentication with recovery codes — optional for users
  (strongly encouraged for uploaders), **mandatory for administrator accounts**.
- **FR-1.4** Session management: rotating refresh tokens, revoke-all-devices, "remembered
  devices" list.
- **FR-1.5** Password reset via single-use, time-limited, emailed token.
- **FR-1.6** Profile: display name, avatar, bio, pedal gear list, links.
- **FR-1.7** Account deletion: step-up re-authentication → soft-delete (sessions revoked,
  profile hidden) → user chooses presets anonymized or removed → scheduled hard-delete of
  PII after 30 days (§6.8).

### FR-2 — Preset upload

- **FR-2.1** Upload form: file picker (drag & drop), pedal brand → model, firmware/editor
  version, section (General | Songs), name, description (Markdown, sanitized), tags
  (max 5 per preset; slugs validated server-side — see FR-7.4).
- **FR-2.2** Songs-section extra fields: song title, artist, album (optional), year (optional).
- **FR-2.3** Multi-file upload: primary preset + up to N companion files (IRs), each
  individually validated.
- **FR-2.4** Server-side validation pipeline: extension allowlist → size cap → magic
  bytes / structural check (per §2.1 validation depth; deep parsers cap JSON nesting
  depth ≤ 64 before parsing) → antivirus/scan → quarantine → publish. Rejected uploads
  return a specific, human-readable error. Objects land in a **private quarantine
  prefix** and become reachable only after `published` (§7.3).
- **FR-2.5** Auto-extract metadata where possible (e.g. `.hlx` preset name, device, firmware)
  and pre-fill the form; user may override non-structural fields only.
- **FR-2.6** Drafts: save an unpublished preset; edit after publish (creates version
  history v1, v2… — each version's primary file is retained and downloadable by hash).
  Every edit/republish re-runs the validation pipeline (FR-2.4) before it goes live.
- **FR-2.7** Quad Cortex type: instead of a file, uploader provides the Cortex Cloud share
  URL/username; the UI validates link format and shows "Open in Cortex Cloud" as the
  download action. Server-side validation uses a real URL parser with an **exact host
  allowlist** (rejects userinfo/port/encoding tricks). The server **never fetches**
  user-supplied URLs (anti-SSRF), and the download redirect re-checks the host
  server-side (anti open-redirect).
- **FR-2.8** Duplicate detection: warn if the same content hash exists (allow override
  with "forked/updated version" note).
- **FR-2.9** License/attestation checkbox: uploader confirms the preset is their own work
  and does not redistribute paid/commercial preset packs or copyrighted IRs.

### FR-3 — Browse, search, filter

- **FR-3.1** Home page: trending (hot ranking), newest, top-rated; per-pedal quick nav.
- **FR-3.2** Pedal page → section tabs (General / Songs) → paginated list.
- **FR-3.3** Filters: pedal, section, tags, genre, firmware version, "uses IRs", has demo
  audio, verified uploader. "Verified uploader" = moderator-granted `users.verified` flag
  (criteria: account in good standing, ≥ 5 published presets, no upheld reports).
- **FR-3.4** Full-text search (Postgres FTS + trigram fallback) across name, description,
  song/artist, tags, uploader.
- **FR-3.5** Sort: hot, new, top all-time, most downloaded, most commented.
- **FR-3.6** Preset detail page: metadata, firmware warning banner when versions mismatch
  the visitor's saved gear (profile gear list), file info (size, hash), download button,
  comments, vote widget, uploader info, version history.
- **FR-3.7** Optional audio demo: uploader may attach a short demo clip (MP3/OGG ≤ 2 MB,
  ≤ 90 s) — v1 nice-to-have, spec'd but deferrable.

### FR-4 — Ranking & comments

- **FR-4.1** Authenticated users may upvote or downvote a preset; one vote per user per
  preset (changeable, idempotent — enforced by unique constraint).
- **FR-4.2** Score = upvotes − downvotes; display both count and net score.
- **FR-4.3** Hot ranking algorithm (stored or computed): time-decayed score based on
  **submission time (newer ranks higher)**, e.g.
  `hot = log10(max(|score|,1)) + sign(score)·(t_created − t₀)/W`, where `t_created` is the
  preset's creation time (Unix), `t₀` a fixed reference epoch, and `W` a tunable window
  (e.g. 45,000 s ≈ 12.5 h, à la Reddit). Score-0 presets still order by recency.
- **FR-4.4** Comments: flat threads with one level of replies (max depth 2), Markdown
  sanitized, edit within 15 min, delete own comments, report button. Stored `body_html`
  is defense-in-depth only — re-sanitize/re-render on read whenever the sanitizer
  version changes.
- **FR-4.5** Comment/vote rate limiting per user (see NFR-6).
- **FR-4.6** Downvotes visible only as net score to normal users (anti-brigading).
- **FR-4.7** Users cannot vote on their own presets.

### FR-5 — Download

- **FR-5.1** One-click download; counter increments once per user per preset per 24 h
  (anonymous downloads counted by day+hash heuristic, capped).
- **FR-5.2** File served from object storage/CDN with `Content-Disposition: attachment`,
  correct MIME/extension, `ETag` = content hash, immutable cache headers. The download
  `filename` is derived from a slugified title + short id (RFC 6266) — never raw
  user-supplied text (prevents header injection).
- **FR-5.3** QC presets: button opens Cortex Cloud link in new tab (no counter fraud —
  count as "click-out").
- **FR-5.4** Download page shows file size, hash, firmware compatibility notice, IR
  dependency warning, and how-to-import instructions per pedal (stored as a template in
  the pedal catalog).

### FR-6 — User profile & library

- **FR-6.1** My presets (with stats: views, downloads, score), my votes, my comments.
- **FR-6.2** Save presets to a personal list ("Favorites") — **Phase 2** (§12), not in v1.
- **FR-6.3** Set gear list (owned pedals) → powers compatibility badges on presets.

### FR-7 — Administration

- **FR-7.1** CRUD pedal catalog: brand, model, aliases, extensions, size limits (preset /
  bundle / companion caps per §2.2.10), validation mode, import instructions, enabled flag.
- **FR-7.2** Moderation queue: reported presets/comments, one-click hide/remove with
  reason + audit log; user ban/unban (shadow + hard).
- **FR-7.3** Stats dashboard: signups, uploads, downloads per pedal, storage used.
- **FR-7.4** Tag governance: rename labels, merge duplicates, blacklist abusive tags
  (blacklist removals applied to affected presets; all audit-logged).

---

## 5. Non-Functional Requirements

### NFR-1 — Performance

| Metric                             | Target                        |
| ---------------------------------- | ----------------------------- |
| API p95 latency (read)             | < 200 ms                      |
| API p95 latency (metadata write)   | < 400 ms                      |
| File upload (pre-signed PUT, 1 MB) | < 2 s on typical broadband    |
| Download time-to-first-byte        | < 100 ms (CDN/object storage) |
| Page load (LCP, 4G)                | < 2.5 s                       |
| Search results p95                 | < 300 ms                      |

Techniques: HTTP caching + CDN for files and images, DB indexes on all sort/filter columns,
materialized trending scores refreshed periodically (or computed on insert), compression
(Brotli/Gzip), code-split frontend, no blocking work in request handlers.

### NFR-2 — Scalability

- Target for v1: **≤ 5,000 registered users, ≤ 100k presets, ≤ 100 GB storage** on a
  single server + object storage; headroom to 10× without re-architecture.
- Stateless API nodes → horizontal scale possible by adding instances + managed Postgres.

### NFR-3 — Availability

- 99.5% monthly uptime for v1; nightly DB backups with 7-day retention **encrypted at
  rest**; object storage versioning or DB-tracked hashes for file integrity.

### NFR-4 — Portability / maintainability

- Containerized (Docker Compose for v1: app, Postgres, MinIO/S3, reverse proxy).
- All pedal/format rules data-driven (see §2.2.7).

### NFR-5 — File safety

- **Never trust the client**: extension allowlist **and** content sniffing (magic bytes)
  **and** per-model size bounds **and** antivirus scan (ClamAV in the pipeline).
- Serve files from a separate domain/bucket origin with `Content-Type:
application/octet-stream`, `X-Content-Type-Options: nosniff`, and non-executable
  disposition — a preset file must never execute in a browser.
- Zip handling: max extraction ratio, no nested archives, max 10 entries. If extraction
  occurs (scanning only), run it sandboxed and validate entry names — reject absolute
  paths, `../` traversal (zip-slip), and symlinks.
- **Never parse XML server-side** (`.tsl` may be XML-based): shallow checks only; if XML
  parsing is ever introduced, disable DTDs and external entities (XXE).
- Demo audio (FR-3.7) served with the correct MIME from the media origin; CSP
  `media-src` scoped accordingly.
- Hash (SHA-256) every stored file; verify on download integrity checks.
- **Avatars & demo media**: allowlist PNG/JPEG/WebP ≤ 1 MB; **re-encode server-side**
  (strips EXIF/metadata; no SVG accepted); cap dimensions. Never serve raw user-supplied
  image bytes — only the re-encoded output is stored and delivered.

### NFR-6 — Abuse control

- Rate limits (per user + per IP): login 5/min, register 3/hour/IP, upload 10/hour,
  vote 60/hour, comment 20/15 min, download 100/hour, 2FA verify 5/15 min (then lockout
  with recovery-code path), password-reset request 3/hour/email, pre-signed upload-url
  30/hour, report creation 20/day.
- Content spam: link limits in comments, mandatory account age (e.g. 10 min) before
  first comment, shadow-ban support.

### NFR-7 — Accessibility & responsiveness

- WCAG 2.1 AA for core flows; fully responsive (mobile-first) UI; keyboard navigable.

### NFR-8 — Observability

- Structured logs, error tracking (Sentry or self-hosted), uptime checks, slow-query log.

### NFR-9 — Quality & testing

- CI gate on every change: lint + typecheck + unit + integration (API) tests must pass
  before merge.
- E2E coverage for core flows: register/login, upload → validate → publish, download,
  vote, comment, moderation actions.
- Format validators regression-tested against a staging corpus of real presets per pedal
  (mitigates R7 false-positives).
- Security test pass (auth, upload, injection, access control) before each release;
  coverage target ≥ 80% on server code.

---

## 6. Authentication & Security Requirements

Aligned to **OWASP ASVS L2** and OWASP Top 10 (2021).

### 6.1 Credentials

- Passwords: **argon2id** (m=64 MB, t=3, p=4 or platform equivalent), min length 12,
  breached-password check (k-anonymity range query against Have I Been Pwned).
- Email verification required before first **upload**; downloads remain open to guests
  (configurable) — consistent with §3.1 and FR-5.1.
- Password reset & email-change tokens: single-use, cryptographically random, 30-min TTL,
  invalidated on use; responses must not reveal account existence (uniform timing/message).

### 6.2 Federated login (OAuth 2.0 / OIDC)

- Providers (MVP): Google, GitHub (Discord optional).
- Authorization Code flow **with PKCE (S256)**, `state` parameter, strict `redirect_uri`
  allowlist, short-lived code, refresh-token rotation.
- Link accounts only after a verified session (prevent account takeover via provider
  email collision); handle "email already registered" without leaking passwords.

### 6.3 Two-factor & recovery

- TOTP (RFC 6238): opt-in for users (strongly encouraged for uploaders), **mandatory for
  admin-role accounts**; 10 single-use recovery codes shown once, hashed at rest.
- Step-up re-authentication for sensitive actions (delete account, change email, revoke
  sessions) **and destructive admin actions** (ban/unban, pedal deletion, mass moderation).
- Role/permission changes have no self-service API; performed out-of-band and
  audit-logged (prevents privilege escalation).

### 6.4 Sessions

- Opaque session IDs in `HttpOnly; Secure; SameSite=Lax` cookies (using the `__Host-`
  prefix); server-side session records; **rotation on privilege change** (login, 2FA on)
  and sliding expiry (idle 7 d / absolute 30 d).
- Refresh tokens (JWT or opaque) are rotating + reuse-detecting (revoke family on reuse).
- "Sign out everywhere" and per-device session list with revoke.

### 6.5 Transport & headers

- TLS 1.2+ (1.3 preferred), HSTS preload, secure cookies.
- Security headers via reverse proxy: CSP (strict-dynamic, no inline), `X-Content-Type-Options:
nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
  permissions policy.
- CSRF: double-submit token (or `Origin` check) on all state-changing requests; OAuth
  callbacks verified by `state`.
- CORS: same-origin only by default — never a wildcard origin with credentials; any
  future external API client requires an explicit allowlist.

### 6.6 Application security

- Input validation on every endpoint (schema-based, e.g. Zod/Joi); parameterized queries
  only (Postgres) — no string-built SQL.
- Output encoding + Markdown sanitization (allowlist tags, no raw HTML) to prevent XSS;
  CSP as second layer.
- Authorization checks server-side per resource (ownership for edit/delete; role for
  admin); never rely on hidden UI.
- File upload security per NFR-5; original filename never used as a storage path
  (content-addressed keys: `sha256/ab/cd/<hash>`).
- Secrets in environment/secret manager, never in repo; dependency scanning (npm audit /
  Dependabot); regular backups tested with restore drills.
- Audit log for admin actions and auth events (login, reset, 2FA changes).
- Mass-assignment protection: explicit per-endpoint field allowlists;
  `role`, `verified`, `status`, `download_count`, `hot_rank`, `version` are server-set
  only and never accepted from request bodies.
- IDOR prevention: preset detail/download endpoints return `status='published'` to
  non-owners (drafts/rejected/hidden are owner/moderator-only); object IDs are ULIDs
  (non-enumerable).
- The server never fetches user-supplied URLs (QC links, profile links) — validation is
  parse-only (anti-SSRF).
- API responses never expose emails, IPs, or other users' PII; emails appear only via
  authenticated self-profile endpoints.
- Validation regexes must be linear-time (no catastrophic backtracking); prefer real
  parsers (URL, JSON) over regex for structured input.

### 6.7 Abuse & anti-fraud

- Rate limiting at reverse proxy (IP) + application (user) — see NFR-6.
- Vote manipulation: unique (user, preset) constraint, daily vote caps, anomaly flags
  (many votes from one IP range) surfaced to moderation.
- Report/flag flow for presets and comments; moderator SLA guidance (48 h).

### 6.8 Privacy & compliance posture (small-community scale)

- Minimal data: email, display name, IP retained only in security logs (≤ 90 days).
- Account deletion (FR-1.7): soft-delete + scheduled hard-delete of PII; user's presets
  anonymized or removed per user choice.
- Terms of Service + Community Guidelines + copyright policy (takedown contact) required
  at launch — see §10.3.

---

## 7. System Architecture

### 7.1 Recommended stack (answer to "can MERN work with Postgres?")

**Yes — with Postgres replacing MongoDB it is commonly called the PERN stack**
(Postgres + Express + React + Node). It is an effective fit here:

| Concern                                                                 | Why PERN fits                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Relational data (presets ↔ pedals ↔ sections ↔ tags ↔ votes ↔ comments) | Postgres referential integrity, constraints, cascades — stronger than Mongo for this domain                  |
| Voting                                                                  | Transactions + `UNIQUE(user_id, preset_id)` makes idempotent votes trivial                                   |
| Search                                                                  | Postgres FTS + `pg_trgm` avoids adding Elastic at this scale                                                 |
| JSON files (`.hlx`)                                                     | Postgres `JSONB` can store extracted metadata & query it                                                     |
| Team familiarity                                                        | MERN skills transfer 1:1; only the DB driver/ODM changes (use **Prisma** or Knex; avoid Mongoose-style ODMs) |
| Performance                                                             | At ≤ 100k presets, a single Postgres instance with proper indexes is comfortably fast                        |

_MongoDB alternative:_ acceptable if you prefer document flexibility, but you would
re-implement vote integrity with extra care and lose cheap JOINs/FTS — not recommended
for this domain.

### 7.2 Component diagram

```
                      ┌──────────────────────────────┐
   Browser (Next.js)  │  CDN / Static assets         │
        │             └──────────────────────────────┘
        │ HTTPS (JSON API + pre-signed transfers)
        ▼
┌───────────────────────┐      ┌──────────────────────────┐
│  Reverse proxy        │      │  Object storage (S3 /    │
│  (Caddy/Nginx)        │      │  MinIO) — preset files,  │
│  TLS, rate limit,     │      │  avatars, demos; PRIVATE │
│  security headers     │      │  until publish → CDN     │
└──────────┬────────────┘      └────────────▲─────────────┘
           │                                │ pre-signed PUT → quarantine prefix
           ▼                                │
┌───────────────────────┐      ┌────────────┴─────────────┐
│  API (Node + Express) │      │  Worker (same codebase): │
│  REST + auth + votes  │─────▶│  file validation, AV     │
│  stateless            │      │  scan, metadata extract, │
└──────────┬────────────┘      │  hot-score refresh       │
           │                   └──────────────────────────┘
           ▼
   ┌─────────────────┐
   │  PostgreSQL 16  │  (+ pg_trgm, FTS)
   └─────────────────┘
```

### 7.3 Key decisions

1. **Files never pass through the DB or (for large files) the API server.** Client
   requests a pre-signed URL → uploads directly to object storage → API finalizes after
   validation. Small files (< 1 MB) may stream through the API for simpler validation.
   Pre-signed PUTs are short-lived (≤ 5 min) and scoped to the expected object key,
   content-length range, and (where the store supports it) a content-hash precondition.
2. **Two-phase publish:** uploaded objects land in a **private quarantine prefix**
   (never public-read) → worker validates → `published` (object promoted to the
   CDN-exposed origin) or `rejected(reason)`. Users see status. A scheduled cleanup
   deletes orphaned quarantine objects (rejected/draft older than 30 days).
3. **CDN/long-lived caching:** storage keys include the content hash → immutable caching
   is safe → fast repeat downloads.
4. **Trending scores** computed by a scheduled worker (every 5 min) into a
   `presets.hot_rank` column, keeping list queries a simple indexed sort.
5. **Server-rendered public pages:** use Next.js (React) with SSR/SSG for public
   browse/detail pages and client components for interactive widgets (votes, comments,
   upload). A fully client-rendered SPA would work, but hurts the LCP < 2.5 s target
   (NFR-1) and hurts SEO/discoverability — the main growth channel (§10.4).
   Implementation note: Next.js emits inline scripts — wire CSP nonces end-to-end
   (proxy → SSR) rather than loosening the policy (§6.5).

---

## 8. Data Model

Core tables (abridged; SQL-style):

```sql
users(id, email UNIQUE, email_verified_at, password_hash NULL, display_name,
      avatar_url, role, verified BOOL DEFAULT false, created_at,
      banned_at NULL, ban_type ENUM('hard','shadow') NULL, deleted_at)

auth_identities(id, user_id FK, provider, provider_user_id, UNIQUE(provider, provider_user_id))

user_gear(id, user_id FK, pedal_id FK, firmware_version NULL,
          UNIQUE(user_id, pedal_id))       -- profile gear list; powers FR-6.3 badges

sessions(id, user_id FK, refresh_family, ip, user_agent, created_at, expires_at, revoked_at)

pedals(id, brand, model, slug UNIQUE, aliases[], firmware_notes, import_instructions_md,
      validation_mode, max_preset_bytes, max_bundle_bytes, max_companion_bytes,
      extensions[], enabled)

presets(id, user_id FK, pedal_id FK, section ENUM('general','songs'), title,
        description_md, song_title NULL, artist NULL, firmware_version,
        kind ENUM('file','bundle','cloud_link'), cloud_url NULL,
        content_hash NULL, storage_key NULL, file_size NULL, file_ext,
        extracted_meta JSONB,        -- e.g. .hlx device id / parsed name
        uses_third_party_ir BOOL, version INT, status ENUM('draft','quarantine','published','rejected','hidden'),
        download_count, hot_rank, created_at, updated_at)

preset_files(id, preset_id FK, preset_version INT, role ENUM('primary','ir','demo_audio'),
             storage_key, content_hash, size, mime, ext)
             -- primary file per version (version history, FR-2.6) + companion files

tags(id, slug UNIQUE, label)
preset_tags(preset_id FK, tag_id FK, PRIMARY KEY(preset_id, tag_id))

votes(user_id FK, preset_id FK, value SMALLINT CHECK (value IN (-1,1)),
      created_at, PRIMARY KEY(user_id, preset_id))

comments(id, preset_id FK, user_id FK, parent_id NULL FK, body_md, body_html,
         created_at, edited_at, deleted_at)

reports(id, reporter_id FK, target_type, target_id, reason, status, handled_by, created_at)

audit_log(id, actor_id, action, target, meta JSONB, ip, created_at)
```

Indexes: `presets(pedal_id, section, status, hot_rank DESC)`,
`presets(status, created_at DESC)`, `preset_files(preset_id, preset_version)`, GIN on FTS
vector + `pg_trgm` on title/song/artist, `votes(preset_id)`, `comments(preset_id, created_at)`.

---

## 9. API Surface (Outline)

REST, JSON, versioned under `/api/v1`. Cookie session (web) + same auth for all.
Pagination: cursor-based for feeds and comments (`cursor`, `limit` ≤ 50); offset
pagination (`page`) only where stable total counts are displayed.

| Method & path                                                                                           | Purpose                                                                        | Auth                |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------- |
| `POST /auth/register` `POST /auth/login` `POST /auth/logout` `POST /auth/refresh`                       | Credential flow                                                                | public / user       |
| `GET /auth/oauth/:provider` `GET /auth/oauth/:provider/callback`                                        | OAuth + PKCE                                                                   | public              |
| `POST /auth/2fa/setup` `POST /auth/2fa/verify` `POST /auth/password/forgot` `POST /auth/password/reset` | 2FA & recovery                                                                 | user / public-token |
| `GET /me` `PATCH /me` `DELETE /me` `GET /me/sessions` `DELETE /me/sessions/:id`                         | Profile, account deletion & sessions                                           | user                |
| `GET /pedals` `GET /pedals/:slug`                                                                       | Pedal catalog                                                                  | public              |
| `POST /presets/upload-url`                                                                              | Request pre-signed URL + begin metadata                                        | user                |
| `POST /presets`                                                                                         | Finalize publish (metadata + storage key)                                      | user                |
| `GET /presets`                                                                                          | List: filters `pedal, section, tag, q, sort`; cursor paging                    | public              |
| `GET /presets/:id`                                                                                      | Detail incl. votes, comments count, file info; `published` only for non-owners | public              |
| `PATCH /presets/:id` `DELETE /presets/:id`                                                              | Edit / remove (owner)                                                          | owner               |
| `GET /presets/:id/download`                                                                             | Redirect to pre-signed/CDN URL; increments count; only `status=published`      | public              |
| `PUT /presets/:id/vote` `{value: 1                                                                      | -1                                                                             | 0}`                 | Cast/change/clear vote | user |
| `GET /presets/:id/comments` `POST /presets/:id/comments` `PATCH /comments/:id` `DELETE /comments/:id`   | Thread                                                                         | public / user       |
| `POST /reports`                                                                                         | Flag content                                                                   | user                |
| `GET /admin/pedals` `POST /admin/pedals` `PATCH /admin/pedals/:id`                                      | Catalog CRUD                                                                   | admin               |
| `GET /admin/reports` `POST /admin/reports/:id/resolve`                                                  | Moderation                                                                     | admin               |
| `GET /admin/stats`                                                                                      | Dashboard: signups, uploads, downloads per pedal, storage (FR-7.3)             | admin               |

Errors: RFC 9457 problem+json with stable `code` values (`FILE_EXTENSION_NOT_ALLOWED`,
`FILE_MAGIC_MISMATCH`, `VOTE_OWN_PRESET`, `RATE_LIMITED`, …).

---

## 10. Feasibility Study

### 10.1 Technical feasibility — **Feasible**

| Area             | Assessment                                                                                                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stack**        | PERN (React/Next-style SPA + Express + Postgres) is mature, well-documented, and well-matched to the relational, vote-heavy workload. No exotic components required.                                                                                                          |
| **File formats** | Feasible with the shallow-to-deep validation strategy in §2. Key uncertainties: (a) undocumented formats may change with firmware — mitigated by data-driven allowlists and community testing; (b) **Quad Cortex has no file format** — mitigated by cloud-link content type. |
| **Performance**  | Preset files are tiny (KB range) — bandwidth is a non-issue; the main costs are search and trending queries, both solved by standard indexing + materialized rank.                                                                                                            |
| **Search**       | Postgres FTS is sufficient at ≤100k rows; no Elasticsearch needed.                                                                                                                                                                                                            |
| **Scale**        | Small-community targets (§NFR-2) are trivially met by one VM + S3-compatible storage; growth path is "add app instances + managed DB".                                                                                                                                        |

**Verdict:** No technical blockers. Highest-risk items are format drift and the QC
cloud-link UX — both have accepted mitigations.

### 10.2 Operational & cost feasibility — **Low cost**

Indicative monthly cost for small-community scale (self-hosted / cloud hybrid):

| Item                                           | Est. cost            |
| ---------------------------------------------- | -------------------- |
| 1× VPS (4 vCPU / 8 GB) or small VM             | $20–40               |
| Object storage + egress (≤ 500 GB egress/mo)   | $5–25                |
| Managed Postgres (or same VPS)                 | $0–15                |
| Domain + TLS (Let's Encrypt)                   | $0–15/yr             |
| Transactional email (Resend/Mailgun free tier) | $0–5                 |
| AV scanning (ClamAV, self-hosted)              | $0                   |
| Backup storage                                 | $2–5                 |
| **Total**                                      | **≈ $30–85 / month** |

Effort estimate (one experienced full-stack developer):

| Phase                                               | Duration         |
| --------------------------------------------------- | ---------------- |
| Auth + security hardening + email flows             | 1.5–2 weeks      |
| Pedal catalog + upload pipeline + validation worker | 2 weeks          |
| Browse/search/detail + download path (CDN)          | 1.5 weeks        |
| Votes, comments, ranking, moderation admin          | 1.5 weeks        |
| UI polish, responsive/accessibility, perf pass      | 1.5 weeks        |
| Testing (incl. security tests), deployment, docs    | 1.5 weeks        |
| **Total MVP**                                       | **≈ 9–11 weeks** |

### 10.3 Legal / content feasibility — **Manageable with policy**

| Issue                            | Analysis & mitigation                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Copyright: artist/song tones** | Presets _emulating_ a tone are generally not redistribution of the recording itself, but naming ("Metallica Master of Puppets tone") is trademark/fair-use territory and sellers of paid packs will object to re-uploads. **Mitigation:** ToS prohibits uploading commercially purchased packs; DMCA/takedown contact; "based on" naming guidance; fast removal workflow. |
| **Third-party IRs**              | IRs are often licensed per-user and may not be redistributable. **Mitigation:** require "uses third-party IRs" declaration; takedown process; do not bundle paid IRs.                                                                                                                                                                                                     |
| **Vendor trademarks**            | Pedal names used descriptively for compatibility — normal practice (guitarpatches.com, GitTone do the same). Add disclaimer: not affiliated/endorsed by any manufacturer.                                                                                                                                                                                                 |
| **Reverse-engineered formats**   | We store vendor files as-is; we do not publish format specs — low risk.                                                                                                                                                                                                                                                                                                   |
| **UGC liability**                | Need Notice-and-Takedown, moderation, and clear Community Guidelines from day one.                                                                                                                                                                                                                                                                                        |

### 10.4 Market / ecosystem feasibility — **Validated by precedent**

Existing sites prove demand: Line 6 **CustomTone**, Fractal **Axe-Change**, Boss **Tone
Exchange/Central**, **guitarpatches.com**, **GitTone** — but they are single-ecosystem or
thin-feature. A **multi-pedal** site with modern UX, unified ranking, and comments fills a
real gap. Risk: users already live inside vendor ecosystems — mitigate with strong search,
per-pedal import instructions, and "works with your gear" compatibility badges.

### 10.5 Schedule feasibility

MVP in 9–11 weeks solo (§10.2); a trimmed scope (single file type first, defer demos &
favorites) can reach a usable beta in ~6 weeks.

---

## 11. Risk Register

| #   | Risk                                                 | Likelihood | Impact | Mitigation                                                                                                                         |
| --- | ---------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Pedal firmware updates break old preset files        | High       | Medium | Mandatory firmware field; version history; compatibility banner; re-publish flow                                                   |
| R2  | Quad Cortex has no downloadable file format          | Certain    | Medium | Cloud-link content type (§2.3); revisit if Neural DSP changes policy                                                               |
| R3  | Malicious file uploads (malware/polyglot)            | Medium     | High   | Multi-layer validation + AV scan + separate origin + nosniff (NFR-5)                                                               |
| R4  | Vote/comment brigading                               | Medium     | Medium | Unique constraints, rate limits, IP anomaly flags, shadow-ban                                                                      |
| R5  | Commercial preset pack re-uploads / takedowns        | Medium     | Medium | ToS + attestation at upload + fast takedown workflow (§10.3)                                                                       |
| R6  | Storage abuse (huge/duplicate files)                 | Low        | Medium | Size caps, hash dedupe, per-user quota, zip-bomb guards                                                                            |
| R7  | Format validation false-positives reject valid files | Medium     | Medium | Validation mode per pedal (strict → shallow), "report bad file" feedback loop, staging corpus of real presets for regression tests |
| R8  | Auth vulnerabilities (session theft, OAuth flaws)    | Low        | High   | OWASP ASVS L2 checklist, pentest pass before launch, security headers (§6)                                                         |
| R9  | Single-server outage                                 | Medium     | Medium | Nightly backups, one-command restore, health checks; Docker Compose for quick reprovisioning                                       |
| R10 | NUX/Zoom extensions vary by editor version           | Medium     | Low    | Data-driven extension allowlists; accept multiple extensions per model; ship per-pedal import docs                                 |

---

## 12. Out of Scope / Future Phases

**Not in v1.0**

- In-browser preset editing / preview rendering of signal chains
- Audio demo clips (spec'd, deferrable — FR-3.7)
- Payments, paid presets, creator payouts
- Mobile apps (responsive web only)
- Auto-conversion between pedals (e.g. `.hlx` → `.prst` converters exist in the
  community but are experimental — future differentiator, not MVP)

**Phase 2 candidates**

- User "Favorites"/collections, follows, presets-per-gear filters
- Notifications: comment replies, vote milestones, moderation outcomes (email + in-app)
- Recommendation engine ("similar presets")
- Community wiki for pedal import guides; API for third-party clients
- QC file support if/when Neural DSP ships local export
- Multi-format uploads & cross-pedal tags, plugin-native presets (Neural DSP plugins
  use `.json`-style plugin presets)

---

## Appendix A — File Format Reference

| Pedal                               | Extensions                                                                               | Format details                                                                                                                                                     | Notes / sources                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Line 6 Helix/HX (legacy)            | `.hlx`                                                                                   | Plain **JSON**; top-level keys `schema` (e.g. `L6Preset`), `version` (e.g. 6), `meta`, `data` (`meta`, `device` id, packed firmware); params stored 0–1 normalized | HX Edit Pilot's Guide; community reverse-engineering (Helrig corpus of 1,246 presets) |
| Line 6 setlist/backup               | `.hls` (setlist), `.hxb` (full-device backup, binary), `.hir` (IR), `.fav`               | Containers; not interchangeable with `.hlx`                                                                                                                        | HX Edit Guide                                                                         |
| Line 6 Helix Stadium (2025+)        | `.hsp` preset, `.hss` setlist, `.hsf` favorite                                           | New schema; **not back-compatible** to older devices once re-saved                                                                                                 | Line 6 manuals (Stadium)                                                              |
| Fractal Audio                       | `.syx` preset (MIDI SysEx), `.fasBundle` (preset + user cabs)                            | SysEx header `F0 00 01 74 <productId> … F7`; product IDs differ per device (Axe-Fx II gen2 vs III gen3 protocol differs)                                           | Fractal Wiki MIDI SysEx; Axe-Edit guides; FracTool                                    |
| Neural Quad Cortex                  | _(no local format)_                                                                      | Distribution exclusively via **Cortex Cloud** account sharing; device downloads to `Presets > Download` folder internally                                          | Neural DSP manual/unity forum; commercial sellers deliver via cloud username          |
| Boss GT-1000/GT-1000CORE            | `.tsl` liveset                                                                           | Exported by BOSS TONE STUDIO (Librarian → Export); contains multiple patches; also liveset exchange on BOSS Tone Exchange                                          | Boss Tone Studio manual                                                               |
| Boss GT-1 / others                  | `.tsl` (and legacy Tone Studio livesets)                                                 | Per-model Tone Studio apps; patches shareable via Tone Central                                                                                                     | Boss docs                                                                             |
| Flamma FX-200 / FX-150              | `.pfl`                                                                                   | Proprietary binary exported by the Flamma FX200/FX150 editor                                                                                                       | Flamma editor software                                                                |
| Zoom (G-series: G5n, G3n, G1 Four…) | `.zptc`                                                                                  | Guitar Lab patch files; drag-out of Guitar Lab exports patches; zip archives from community sites contain `.zptc`                                                  | ZOOM Guitar Lab v6 reference guide; community                                         |
| Zoom MS-50G etc.                    | SysEx dumps / text hex                                                                   | SysEx `F0 52 00 <devId> … F7`, 146-byte patch payload (MS-50G)                                                                                                     | zoom-ms-utility MIDI docs                                                             |
| NUX MG-30/MG-400                    | QuickTone export files (`.mg30patch`, `.mg400patch`, `.nuxpreset` observed in community) | Proprietary binary; **GEN2 firmware ↔ GEN2 QuickTone only**; V5 firmware ↔ V5 QuickTone                                                                            | NUX site; guitarpatches.com; GitTone                                                  |
| Valeton GP-200                      | `.prst`                                                                                  | Binary, **exactly 1224 bytes**; magic `TSRP` (reversed "PRST") + device `2-PG`; 11 blocks × 72 bytes (uint32 effect code, active flag, 15× float32); 305 effects   | Valeton FAQ; open-source `prstdecoder` / Preset Forge RE docs                         |
| Companion files                     | `.wav` (IR, 44.1 kHz/24-bit, 1024 samples typical), `.hir`, `.syx` (IR)                  | Referenced by presets; may be missing → user-facing warning                                                                                                        | Vendor IR docs                                                                        |

**Validation modes summary**

| Mode           | Used by                            | Checks                                                           |
| -------------- | ---------------------------------- | ---------------------------------------------------------------- |
| `deep_json`    | Line 6 `.hlx`/`.hsp`               | JSON parse, schema key, version, device id, size                 |
| `sysex`        | Fractal `.syx`, Zoom MS            | `F0` start, manufacturer/product ID, `F7` end, size              |
| `fixed_binary` | Valeton `.prst`                    | exact size + magic                                               |
| `shallow`      | `.tsl`, `.pfl`, `.zptc`, NUX files | extension allowlist + size + (optional) entropy/header heuristic |
| `cloud_link`   | Quad Cortex                        | URL pattern validation against `cloud.neuraldsp.com`             |

---

## Appendix B — Glossary

| Term               | Meaning                                     |
| ------------------ | ------------------------------------------- |
| **AIRD**           | Boss amp tech (Integrated Dynamic)          |
| **CorOS**          | Quad Cortex operating system                |
| **Cortex Cloud**   | Neural DSP's preset/capture sharing service |
| **FTS**            | Full-text search                            |
| **Hot ranking**    | Time-decayed score used for "Trending"      |
| **IR**             | Impulse Response (cabinet simulation)       |
| **Liveset**        | Boss term for an exported group of patches  |
| **Neural Capture** | Quad Cortex hardware capture profile        |
| **QuickTone**      | NUX's editor software                       |
| **SysEx**          | MIDI System Exclusive data                  |
| **Tone Studio**    | Boss editor software                        |
| **WEI / PKCE**     | OAuth 2.0 hardening mechanisms              |

---

_End of document — SRS v1.0_
