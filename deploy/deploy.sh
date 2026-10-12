#!/bin/sh
# Deployed by the "deploy" job in .gitlab-ci.yml.
# Runs on the target server from $DEPLOY_PATH; pulls the freshly built images
# and recreates the stack. Env/secrets live in deploy/.env (not shipped by CI).
set -eu

: "${IMAGE_TAG:?IMAGE_TAG is required}"
: "${REGISTRY:?REGISTRY is required}"
: "${REGISTRY_USER:?REGISTRY_USER is required}"
: "${REGISTRY_PASSWORD:?REGISTRY_PASSWORD is required}"

COMPOSE="deploy/docker-compose.prod.yml"

echo "==> Logging in to $REGISTRY"
echo "$REGISTRY_PASSWORD" | docker login "$REGISTRY" -u "$REGISTRY_USER" --password-stdin

export IMAGE_TAG REGISTRY

echo "==> Pulling images ($REGISTRY/{api,web}:$IMAGE_TAG)"
docker compose -f "$COMPOSE" pull

echo "==> Starting stack (api entrypoint applies prisma migrate deploy)"
docker compose -f "$COMPOSE" up -d --remove-orphans

echo "==> Pruning dangling images"
docker image prune -f

docker compose -f "$COMPOSE" ps
