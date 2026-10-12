.DEFAULT_GOAL := help
SHELL := /bin/sh

.PHONY: help install dev build start lint lint-fix typecheck test test-int test-coverage \
        format check clean db-setup db-migrate db-seed db-studio \
        docker-up docker-down docker-build docker-logs

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies (npm ci)
	npm ci

dev: ## Start API (:4000) and Web (:3000) dev servers
	npm run dev

build: ## Production build of both apps
	npm run build

start: ## Start the production API
	npm run start

lint: ## Lint both workspaces
	npm run lint

lint-fix: ## Auto-fix lint issues in both workspaces
	npm run lint:fix

typecheck: ## Type-check both workspaces
	npm run typecheck

test: ## Run unit tests for both workspaces
	npm run test

test-int: ## Run the HTTP integration suite (API + DB must be running)
	npm run test:integration

test-coverage: ## Run unit tests with coverage reports
	npm run test:coverage

check: lint typecheck test ## Lint + typecheck + unit tests

format: ## Format the repo with Prettier
	npm run format

clean: ## Remove build artifacts and caches
	npm run clean

db-setup: db-migrate db-seed ## Apply migrations then seed the database

db-migrate: ## Apply database migrations
	npm run db:migrate

db-seed: ## Seed catalog + tags (idempotent)
	npm run db:seed

db-studio: ## Open Prisma Studio
	npm run db:studio

docker-up: ## Start the full stack via docker compose
	docker compose up -d

docker-down: ## Stop the docker compose stack
	docker compose down

docker-build: ## Build the docker images
	docker compose build

docker-logs: ## Tail docker compose logs
	docker compose logs -f