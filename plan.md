# GuitarHub — Performance, Response Time & Backup Optimization Plan

- **Status:** Draft for execution
- **Scope owner:** Platform / Backend
- **Aligns to:** SRS §5 (NFR-1 Performance, NFR-2 Scalability, NFR-3 Availability, NFR-8 Observability), §7.3 (key decisions)
- **Posture (decided):** pragmatic single-server first; Redis/pgbouncer/CDN/read-replica are documented P2 upgrade ladders, not prerequisites.
- **Backup posture (decided):** nightly encrypted logical dumps to offsite object storage, 7-day retention (GFS: 7 daily + 4 weekly), pre-deploy snapshot, automated restore verification. PITR noted as a follow-up.

---

## 1. Purpose

Make GuitarHub meet its non-functional targets and hold them with headroom to 10× scale (5k → 50k users, 100k → 1M presets, ~100 GB → ~1 TB storage) by optimizing:

1. **API performance** — database query cost and p95 latency.
2. **Response time** — end-to-end delivery of API responses, pages (LCP) and file downloads (TTFB).
3. **Backups** — durable, encrypted, offsite, _restorable_ backups with a repeatable recovery procedure.

**Out of scope:** new product features; the auth/security hardening backlog (tracked separately).

---

## 2. Current state & findings (evidence)

Stack: npm-workspaces monorepo — `apps/api` (Express 5 + Prisma + PostgreSQL 16), `apps/web` (Next.js 16, client-rendered pages), object storage via MinIO/S3 (or local driver), Caddy reverse proxy, Docker Compose.

### 2.1 Performance / latency

| #   | Severity | Finding                                                                                                                                                                                                                           | Evidence                                                                                                                 |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| P1  | High     | `GET /presets` loads **all** published rows, then loads all votes/comments/tags/files for every candidate, filters (tag/verified/q) in JS, sorts in JS, and paginates in memory. O(N) per request; will not hold at 100k presets. | `apps/api/src/routes/presets.ts:637-773`                                                                                 |
| P1  | High     | Whole `Tag` table fetched on every list request.                                                                                                                                                                                  | `presets.ts:667`                                                                                                         |
| P1  | High     | Vote aggregation re-filters the full vote array per preset → O(N·V).                                                                                                                                                              | `presets.ts:729-736`                                                                                                     |
| P1  | High     | Search `q` is a case-insensitive JS substring scan over all candidates; the **pg_trgm GIN indexes are never used**.                                                                                                               | `presets.ts:706-720`; indexes in `apps/api/prisma/migrations/20261008092000_phase4_search/migration.sql:7-11`            |
| P1  | High     | `hotRank` recomputed at read time for sorting; the cached column and its index are unused.                                                                                                                                        | `presets.ts:617-623`; `apps/api/src/lib/hot-rank.ts`; index `[pedalId, section, status, hotRank]` in `schema.prisma:237` |
| P2  | Medium   | Hot-rank worker is N+1: one `findMany` + one `update` per published preset every 5 min.                                                                                                                                           | `lib/hot-rank.ts:42-54`; `jobs/refresh-hot-rank.ts`                                                                      |
| P2  | Medium   | `GET /pedals` runs an N+1 `preset.count` per pedal (parallel, still N queries); admin stats similar.                                                                                                                              | `apps/api/src/routes/pedals.ts:28-35`                                                                                    |
| P2  | Medium   | `GET /presets/:id/comments` loads all top-level comments then slices in memory; cursor via `findIndex`.                                                                                                                           | `presets.ts:951-996`                                                                                                     |
| P2  | Medium   | Write-on-read: `viewCount++` on every detail read; `downloadCount++` synchronously on the download path.                                                                                                                          | `presets.ts:784-788`, `presets.ts:567-571`                                                                               |
| P3  | Low      | No compression middleware; only Caddy `encode gzip` (no zstd/brotli).                                                                                                                                                             | `apps/api/src/app.ts` (no `compression`); `deploy/Caddyfile:7`                                                           |
| P3  | Low      | No public caching headers / `ETag` on read endpoints; only download sets `no-store`.                                                                                                                                              | `presets.ts:1089`                                                                                                        |
| P3  | Low      | Rate limiting is in-memory per process; Prisma uses the default pool — single-node assumptions.                                                                                                                                   | `apps/api/src/lib/rate-limit.ts`; `apps/api/src/lib/prisma.ts`                                                           |
| P3  | Low      | Per-request session lookup (+ throttled hourly write) on every authenticated call.                                                                                                                                                | `apps/api/src/middleware/auth.ts:32-38`; `lib/session.ts:77-86`                                                          |

### 2.2 Backup / disaster recovery

| #   | Severity | Finding                                                                                                        | Evidence                                                                             |
| --- | -------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| B1  | Critical | **No database backup mechanism at all** — only the `postgres_data` Docker volume. SRS NFR-3 unmet.             | `docker-compose.yml:11-17`, `deploy/docker-compose.prod.yml:24-25`                   |
| B2  | Critical | No encryption, offsite copy, retention policy, or restore drill.                                               | none present                                                                         |
| B3  | High     | MinIO bucket has no versioning / object-lock / replication.                                                    | `docker-compose.yml:29-37` (`minio-init` only creates bucket + `anonymous set none`) |
| B4  | High     | Deploy runs `prisma migrate deploy` with no pre-migration snapshot; a bad migration is unrecoverable in place. | `deploy/deploy.sh:22-23`; `apps/api/Dockerfile` CMD                                  |

---

## 3. Targets & success metrics

| Metric                           | Target (SRS)                                                   | Verification                                       |
| -------------------------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| API p95 latency (read)           | < 200 ms                                                       | k6/autocannon against a seeded 100k-preset dataset |
| API p95 latency (metadata write) | < 400 ms                                                       | same                                               |
| Search p95                       | < 300 ms                                                       | same, `q=` scenarios                               |
| Download time-to-first-byte      | < 100 ms                                                       | presigned/CDN redirect timing                      |
| Page LCP (4G)                    | < 2.5 s                                                        | Lighthouse CI budget                               |
| Availability                     | 99.5% monthly                                                  | uptime monitor + healthchecks                      |
| Backup                           | nightly, encrypted, offsite, 7-day retention, restore verified | restore drill + dead-man's-switch heartbeat        |

---

## 4. Workstream A — Database & query performance

The highest-leverage workstream; it directly moves the p95 and search targets.

- **A1 — Rewrite `GET /presets` as a single SQL-backed query.** (`presets.ts:637`)
  Build a dynamic `where`, `ORDER BY <sortKey> DESC, id DESC`, `take: limit + 1` **keyset pagination**; compute counts via `groupBy`/correlated subqueries scoped to the page only. Eliminates full-table scan + in-memory sort. Effort: **L**.
- **A2 — Push search & tag filters into Postgres.** Use `contains`/`mode: insensitive` on `title`/`songTitle`/`artist` (already backed by pg_trgm GIN), and filter tags via a join or precomputed tag-slug array. Add a `tsvector` column + GIN only if ranking quality requires it. Effort: **M**.
- **A3 — Sort `hot` on the cached `hotRank` column** (index exists, `schema.prisma:237`); keep read-time math as a fallback only. Batch the worker with a set-based `UPDATE … FROM (SELECT … GROUP BY presetId)` instead of N+1. Effort: **M**. (`lib/hot-rank.ts:42-54`)
- **A4 — Denormalized counters** for `score` and `commentCount`, maintained on vote/comment writes, with a nightly reconcile job to prevent drift. Effort: **M**.
- **A5 — Write-behind counters** for `viewCount`/`downloadCount`: buffer increments in memory and flush on an interval, removing writes from the read/download hot path. Effort: **M**. (`presets.ts:784`, `presets.ts:567`)
- **A6 — Index review.** Add partial indexes (`… WHERE status = 'PUBLISHED'`) and covering indexes for each list sort; confirm plans with `EXPLAIN (ANALYZE, BUFFERS)`. Effort: **S**.
- **A7 — Grouped counts** for `GET /pedals` and admin stats (one `groupBy` per endpoint instead of N counts). Effort: **S**. (`pedals.ts:28`)
- **A8 — Fix comment pagination** to page at the DB level rather than load-all-then-slice. Effort: **S**. (`presets.ts:951`)

**Acceptance:** list/search/pedals endpoints issue a bounded number of queries independent of dataset size; `EXPLAIN` shows index scans; p95 read < 200 ms and search p95 < 300 ms on the 100k dataset.

---

## 5. Workstream B — API response time & caching (single-server)

- **B1 — Compression.** Add the `compression` middleware (brotli/gzip) and enable `zstd` in Caddy: `encode zstd gzip`. Effort: **S**. (`app.ts`; `deploy/Caddyfile:7`)
- **B2 — HTTP caching & validators.** Emit `Cache-Control: public, s-maxage=<n>, stale-while-revalidate=<n>` + strong `ETag`/`Last-Modified` for public GETs (`/pedals`, `/tags`, `/presets` list/detail). Keep authenticated/private responses `private, no-store` and add a test asserting it. Effort: **M**.
- **B3 — In-process TTL cache** (small LRU) for catalog data (pedals, tags) with invalidation on admin writes. Document the Redis swap for P2. Effort: **M**.
- **B4 — Deferred counters** (shared with A5) so reads never block on writes. Effort: folded into A5.
- **B5 — Optional session cache** to remove the per-request session lookup at higher volume. Effort: **M**. (`middleware/auth.ts:32`)
- **B6 — Caddy tuning:** HTTP/2 (and HTTP/3 where available), keep-alive, `zstd`, and long-lived immutable caching for hashed static assets. Effort: **S**. (`deploy/Caddyfile`)

**Acceptance:** public responses carry cache headers + ETag; gzip/brotli/zstd verified on large JSON; authenticated responses never cacheable; repeat read latency reduced.

---

## 6. Workstream C — Frontend delivery (LCP)

- **C1 — Move public pages to RSC/SSR.** Convert home, browse (`presets`), preset detail and `pedals` from `"use client"` fetch-on-mount to server components with `revalidate` + streaming, so HTML is server-rendered and CDN-cacheable. Effort: **L**. (`apps/web/src/app/presets/page.tsx:1`, `pedals/page.tsx:1`, `page.tsx:1`)
- **C2 — Image/media optimization** via `next/image`; keep avatars/demo media server-side re-encoded (NFR-5). Effort: **M**.
- **C3 — CDN-grade download delivery** with immutable, content-hash cache headers (the download route already 302-redirects to a presigned/CDN URL). Effort: **M**. (`presets.ts:1109`)
- **C4 — Bundle hygiene:** route-level code splitting, prefetching, font strategy. Effort: **S**.

**Acceptance:** Lighthouse LCP < 2.5 s on the public browse/detail flows; no regressions in the existing web test suite.

---

## 7. Workstream D — Statelessness & scale-out (P2 upgrade ladder)

Documented now, implemented when traffic demands — kept out of P0/P1 to honor the single-server posture.

- **D1 — Shared rate-limit/idempotency store** (Redis) with in-process fallback. (`lib/rate-limit.ts`)
- **D2 — pgbouncer** + explicit connection caps between API and Postgres. (`lib/prisma.ts`)
- **D3 — Run N stateless API replicas** behind Caddy; add a `/ready` readiness probe distinct from `/health`. (`routes/health.ts`)
- **D4 — Optional read replica** for browse/search reads.

---

## 8. Workstream E — Backup, restore & DR (P0 — compliance gap)

Implements SRS NFR-3: nightly DB backups with 7-day retention, **encrypted at rest**, offsite.

- **E1 — Nightly encrypted logical backups.** `pg_dump -Fc` → `gzip` → `age -r <recipient>` → local staging dir **and** offsite object storage (S3/MinIO). GFS retention: **7 daily + 4 weekly**. Run from a dedicated `backup` Compose service or a host systemd timer. Effort: **M**.
- **E2 — (Follow-up) PITR.** WAL archiving + base backups via `wal-g`/`pgBackRest` for RPO ≤ 5 min. Effort: **L**.
- **E3 — Object storage durability.** Enable MinIO versioning + lifecycle rules; mirror the bucket offsite (or enable replication); consider object-lock for ransomware protection. Effort: **M**. (`docker-compose.yml:29-37`)
- **E4 — Pre-deploy snapshot.** In `deploy/deploy.sh`, take a DB snapshot **before** `docker compose up` and abort the deploy if it fails. Effort: **S**. (`deploy/deploy.sh:22-23`)
- **E5 — Scripts + automated verification.** `scripts/backup.sh`, `scripts/restore.sh`, `scripts/backup-verify.sh` — the verifier restores the latest dump into a throwaway database, runs `prisma migrate status` and asserts row counts, then drops it. **A backup is only "done" when its restore succeeds.** Effort: **M**.
- **E6 — Key management.** `age` recipients (or CI secret store) for encryption keys; never commit keys; document rotation. Effort: **S**. (`.env.example`, `.gitlab-ci.yml` variables)
- **E7 — Monitoring.** Dead-man's-switch heartbeat (e.g. healthchecks.io) pinged on success; alert on failure/absence. Effort: **S**.
- **E8 — Runbook.** Document RPO/RTO, the restore procedure, and a quarterly restore drill. Effort: **S**.

**Acceptance:** a scheduled backup lands encrypted offsite; the verifier restores it into a temp DB and passes; a deliberate failure raises an alert; `deploy.sh` refuses to deploy when the pre-snapshot fails.

---

## 9. Workstream F — Observability & performance regression guard

- **F1 — Query & latency visibility.** Enable Postgres `log_min_duration_statement`; Prisma query metrics; export p95 latency histograms (pino/OTel → Prometheus/Grafana). Effort: **M**. (NFR-8)
- **F2 — Error tracking.** Sentry (or self-hosted). Effort: **S**.
- **F3 — Load-test harness.** k6/autocannon scripts against a seeded 100k-preset dataset; run weekly and pre-release; store a baseline and fail on regression. Effort: **M**.
- **F4 — Frontend budget.** Lighthouse CI LCP budget in the pipeline. Effort: **S**.

---

## 10. Roadmap & sequencing

| Phase  | Window    | Items                                      | Outcome                                                                              |
| ------ | --------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| **P0** | Weeks 1–2 | B1, B2, A1, A3, A4, A7, E1, E4, E5         | Immediate p95 + response-time wins; **backups (NFR-3) closed**                       |
| **P1** | Weeks 3–5 | A2, A5, A6, A8, B3, B5, B6, C1, E3, E7, E8 | Search pushed to Postgres; catalog caching; SSR for public pages; storage durability |
| **P2** | Weeks 6–9 | D1–D4, C2, C3, C4, E2, F1, F3, F4          | Scale-out ladder, image/CDN delivery, observability + regression guard, PITR         |

---

## 11. Risks & tradeoffs

- **New infra vs simplicity.** Redis/pgbouncer/PITR add operational surface; P0 deliberately stays single-server/in-process with explicit upgrade ladders (D1–D4, E2).
- **Denormalized counters can drift.** Mitigated by a nightly reconcile job (A4) and the backup verifier catching gross divergence.
- **Caching correctness.** Authenticated responses must never be cached; enforced by policy tests (B2).
- **Migration safety.** Snapshot-before-deploy (E4) plus restore drills (E5/E8) bound the blast radius of schema changes.
- **Effort estimates** are relative (S < 1 day, M ≈ 1–3 days, L > 3 days) and assume one engineer.

---

## 12. Definition of Done (every item)

1. Code + tests merged; `npm run check` (lint + typecheck + unit) green and unchanged test count reconciled.
2. For DB items: an `EXPLAIN (ANALYZE, BUFFERS)` (or load-test delta) recorded in the PR.
3. For backup items: a **successful automated restore** demonstrated.
4. SRS NFR mapping updated; `progress.md` phase entries updated.

---

## 13. Decisions (resolved) & open items

**Resolved**

- Infra posture: **pragmatic single-server first**; Redis/pgbouncer/CDN/replica are P2 ladders.
- Backup posture: **nightly encrypted offsite dumps, 7-day retention**, pre-deploy snapshot, automated restore verification.
- Output: this document at `D:\Software Projects\GuitarHub\plan.md`.

**Open (resolve at kickoff)**

- Offsite storage target (which S3/MinIO endpoint + credentials source) and the `age` recipient/key custodian.
- PITR go/no-go date (E2) based on acceptable RPO (≤ 5 min vs ≤ 24 h).
- Whether a managed CDN (e.g. Cloudflare) is acceptable for file delivery/LCP (C3).
- The 100k-preset seed generator for F3 (synthetic vs anonymized production sample).
