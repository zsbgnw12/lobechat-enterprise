#!/bin/sh
set -e

NODE_ENV="${NODE_ENV:-development}"
ALLOW_DATA_LOSS="${ALLOW_DATA_LOSS:-false}"

if [ "$NODE_ENV" = "production" ]; then
  if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then
    echo "[entrypoint] production: prisma migrate deploy..."
    npx prisma migrate deploy
  else
    echo "[entrypoint] FATAL: NODE_ENV=production but no prisma/migrations committed."
    echo "[entrypoint] Refusing to run 'prisma db push' in production."
    echo "[entrypoint] Generate migrations via 'npx prisma migrate dev --name init --create-only' and commit them."
    exit 1
  fi
else
  echo "[entrypoint] dev: prisma db push..."
  if [ "$ALLOW_DATA_LOSS" = "true" ]; then
    npx prisma db push --accept-data-loss --skip-generate
  else
    npx prisma db push --skip-generate
  fi
fi

echo "[entrypoint] seeding..."
node dist/prisma/seed.js || echo "[entrypoint] seed warning (may already be seeded)"

echo "[entrypoint] starting server..."
exec node dist/src/server.js
