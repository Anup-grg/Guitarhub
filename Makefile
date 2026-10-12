.PHONY: help install dev build start lint lint-fix typecheck test test-int test-coverage check clean db-migrate db-seed db-studio db-setup docker-up docker-down docker-build docker-logs

help:
	@echo "GuitarHub - Available make targets:"
	@echo "  install      - Install dependencies (npm ci)"
	@echo "  dev          - Start development servers (API + Web)"
	@echo "  build        - Build both applications"
	@echo "  start        - Start production API"
	@echo "  lint         - Lint both workspaces"
	@echo "  lint-fix     - Auto-fix linting issues"
	@echo "  typecheck    - Run TypeScript type checking"
	@echo "  test         - Run unit tests"
	@echo "  test-int     - Run integration tests (requires API + DB running)"
	@echo "  test-coverage- Run tests with coverage"
	@echo "  check        - Run lint + typecheck + test"
	@echo "  clean        - Clean build artifacts and caches"
	@echo "  db-migrate   - Run database migrations"
	@echo "  db-seed      - Seed database"
	@echo "  db-studio    - Open Prisma Studio"
	@echo "  db-setup     - Migrate and seed database"
	@echo "  docker-up    - Start Docker containers"
	@echo "  docker-down  - Stop Docker containers"
	@echo "  docker-build - Build Docker images"
	@echo "  docker-logs  - Follow Docker logs"

install:
	npm ci

dev:
	npm run dev

build:
	npm run build

start:
	npm run start

lint:
	npm run lint

lint-fix:
	npm run lint -- --fix -w api && npm run lint -- --fix -w web

typecheck:
	npm run typecheck

test:
	npm run test

test-int:
	npm run test:integration

test-coverage:
	npm run test -- --coverage -w api && npm run test -- --coverage -w web

check: lint typecheck test

clean:
	@echo "Cleaning build artifacts..."
	rmdir /s /q apps\api\dist 2>nul || exit 0
	rmdir /s /q apps\web\.next 2>nul || exit 0
	rmdir /s /q apps\web\out 2>nul || exit 0
	rmdir /s /q apps\api\coverage 2>nul || exit 0
	rmdir /s /q apps\web\coverage 2>nul || exit 0
	rmdir /s /q coverage 2>nul || exit 0
	rmdir /s /q .next 2>nul || exit 0
	rmdir /s /q node_modules\.cache 2>nul || exit 0
	@echo "Cleaned!"

db-migrate:
	npm run db:migrate

db-seed:
	npm run db:seed

db-studio:
	npm run db:studio

db-setup: db-migrate db-seed

docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-build:
	docker compose build

docker-logs:
	docker compose logs -f
