# GuitarHub

Community preset sharing platform for guitar multi-effects pedals.
Built from `SRS.md` v1.0 — PERN stack (PostgreSQL, Express, React/Next.js, Node).

## Build phases

| Phase | Scope                                                                                                                              | Status      |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1     | Foundation: monorepo, PostgreSQL schema + migrations, pedal catalog seed, API skeleton, web shell, Docker Compose, unit tests (63) | ✅ complete |
| 2     | Auth & accounts: register/login, sessions, TOTP 2FA, OAuth (Google/GitHub), password reset, profiles                               | ✅ complete |
| 3     | Pedal catalog API + preset upload pipeline: pre-signed uploads, per-format validators, quarantine → publish, QC cloud links        | ✅ complete |
| 4     | Browse, search & download: feeds, filters, FTS, detail pages, CDN download path                                                    | ✅ complete |
| 5     | Votes, comments & hot ranking                                                                                                      | ✅ complete |
| 6     | Admin & moderation: pedal CRUD, reports queue, stats, tag governance                                                               | ✅ complete |
| 7     | UI polish, accessibility, testing, deployment hardening                                                                            | ✅ complete |

## Stack

- **Monorepo**: npm workspaces — `apps/api` (Express 5 + TypeScript), `apps/web` (Next.js 16, Tailwind 4)
- **Database**: PostgreSQL 16 via Prisma (`apps/api/prisma/schema.prisma`)
- **Deploy**: Docker Compose (Postgres, MinIO, API, Web, Caddy) — see `docker-compose.yml`

## Prerequisites (local dev)

- Node.js ≥ 22 (tested on 24), npm ≥ 10 (tested on 12)
- PostgreSQL 16 running on `localhost:5432` (create the DB once: `CREATE DATABASE guitarhub;`)

## Commands

```bash
npm install               # install all workspaces

# database
npm run db:migrate        # create/apply migrations (prisma migrate dev)
npm run db:seed           # seed pedal catalog + tags (idempotent)
npm run db:studio         # Prisma Studio

# development
npm run dev               # API :4000 + Web :3000 (web proxies /api → API)
npm run lint              # eslint across workspaces
npm run lint:fix          # eslint --fix across workspaces
npm run typecheck         # tsc --noEmit across workspaces
npm test                  # vitest across workspaces (unit tests)
npm run test:coverage     # unit tests with v8 coverage reports
npm run test:integration  # E2E integration suite vs the dev DB (API must be running; BASE_URL to target origin)
npm run build             # production build of both apps
npm run check             # CI gate: lint + typecheck + unit tests
npm run format            # prettier --write across the repo
npm run format:check      # prettier --check (used in CI)
npm run clean             # remove build artifacts and caches

# production (containers)
docker compose up --build
```

## Automation

- **Pre-commit hook.** [Husky](https://typicode.github.io/husky/) runs
  [lint-staged](https://github.com/lint-staged/lint-staged) on staged files: ESLint
  (per-workspace flat config) on TS/JS and Prettier on JSON/Markdown/YAML.
- **Pre-push hook.** Running `git push` executes `npm run check`
  (lint + typecheck + unit tests) locally before the push leaves your machine, so
  obvious breakages are caught before CI.
- Hooks are installed automatically via the `prepare` script on `npm install` and
  skip on CI (`is-ci`). Bypass in an emergency with `git commit/push --no-verify`.
- **Formatting.** Prettier + `.editorconfig`; `.gitattributes` normalizes line endings
  to LF so Windows dev and Linux CI agree.
- **Coverage.** `npm run test:coverage` emits `text`/`lcov`/`html` via `@vitest/coverage-v8`.
- **Validation wrappers.** `scripts/validate.sh` / `scripts/validate.ps1` wrap `npm run check`.

### Make targets

The `Makefile` is a thin, POSIX convenience wrapper over the npm scripts above (local
dev only — CI runs the npm scripts directly). Requires GNU `make` (macOS/Linux, or
`choco install make` / `winget install GnuWin32.Make` on Windows).

```bash
make            # list targets (default goal)
make install    # npm ci
make dev        # API :4000 + Web :3000
make check      # lint + typecheck + unit tests
make test-coverage
make format
make clean
make db-setup   # migrate + seed
make docker-up  # docker compose up -d
```

## CI/CD (GitLab + self-hosted Docker Compose)

`.gitlab-ci.yml` runs five stages: **verify** (lint + typecheck + unit tests),
**integration** (Postgres service + seeded DB + HTTP e2e), **build** (Kaniko →
GitLab Container Registry), **security** (secret/dependency/container scanning +
`npm audit`, non-blocking), and **deploy** (SSH → `deploy/deploy.sh` →
`docker compose pull && up -d` on `main`). Migrations apply automatically via the
api container entrypoint (`prisma migrate deploy`).

Required GitLab CI/CD variables: `DEPLOY_SSH_KEY` (masked + protected),
`DEPLOY_USER`, `DEPLOY_HOST`, `DEPLOY_PATH`, `POSTGRES_PASSWORD`,
`MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `STORAGE_SIGNING_SECRET` (plus
optional `APP_URL`, `COOKIE_SECURE=true`, OAuth/SMTP).

Server bootstrap: Docker + Compose, a `deploy` user with the CI key, and
`$DEPLOY_PATH/deploy/.env` holding the production secrets (this file is
preserved across deploys). Point `deploy/Caddyfile` at your hostname for TLS.

## Layout

```
GuitarHub/
├── SRS.md                     # Software Requirements Specification
├── docker-compose.yml         # prod-style stack (postgres, minio, api, web, caddy)
├── deploy/Caddyfile           # reverse proxy + security headers
└── apps/
    ├── api/                   # Express 5 + Prisma REST API
    │   ├── prisma/            # schema, migrations, seed
    │   └── src/               # config, routes, error handling (RFC 9457)
    └── web/                   # Next.js app (SSR shell; proxies /api in dev)
```

## Conventions

- Object IDs are **ULIDs** generated by `apps/api/src/lib/id.ts` (no DB default)
- Errors use RFC 9457 `application/problem+json` with stable `code` values
- Pedal/format rules are **data** (seeded rows), not code — SRS §2.2.7
