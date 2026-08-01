#!/bin/sh
set -eu

app_dir=${STENTOR_APP_DIR:-/opt/stentor}
health_url=${STENTOR_HEALTH_URL:-http://127.0.0.1:3000/health/ready}

if [ "$(id -u)" -ne 0 ]; then
  printf 'Stentor deployment must run as root.\n' >&2
  exit 1
fi

cd "$app_dir"

if [ ! -f .env ]; then
  printf 'Missing %s/.env\n' "$app_dir" >&2
  exit 1
fi

if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  printf 'Refusing to deploy a dirty production worktree.\n' >&2
  git status --short >&2
  exit 1
fi

git fetch origin main
git pull --ff-only origin main
docker compose config --quiet

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
rollback=""
if docker image inspect stentor-bot:latest >/dev/null 2>&1; then
  rollback="stentor-bot:rollback-$timestamp"
  docker tag stentor-bot:latest "$rollback"
fi

restore_previous() {
  if [ -n "$rollback" ]; then
    docker tag "$rollback" stentor-bot:latest
    docker compose up -d --force-recreate bot
  fi
}

docker compose build bot
docker compose run --rm --no-deps bot node dist/register-commands.js
if ! docker compose up -d --remove-orphans; then
  restore_previous
  printf 'Deployment failed during startup; previous image restored when available.\n' >&2
  exit 1
fi

ready=false
for _attempt in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 5 "$health_url" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done

if [ "$ready" != true ]; then
  docker compose logs --tail=100 bot >&2 || true
  restore_previous
  printf 'Deployment failed readiness; previous image restored when available.\n' >&2
  exit 1
fi

{ docker images --format '{{.Repository}}:{{.Tag}}' | grep '^stentor-bot:rollback-' || true; } \
  | sort -r \
  | tail -n +3 \
  | xargs -r docker image rm >/dev/null

printf 'Stentor deployment healthy at %s\n' "$(git rev-parse --short HEAD)"
