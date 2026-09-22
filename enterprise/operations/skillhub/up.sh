#!/usr/bin/env bash
# [enterprise-fork] Start / stop a SkillHub sidecar without vendoring upstream Compose.
set -euo pipefail

PIN="${SKILLHUB_PIN:-v0.2.21}"
PROJECT="heihub-skillhub"
ROOT="$(cd "$(dirname "$0")" && pwd)"
RUNTIME="$ROOT/.runtime"
OVERLAY="$ROOT/env.heihub.example"
COMPOSE="$RUNTIME/compose.release.yml"
ENV_EXAMPLE="$RUNTIME/.env.release.example"
ENV_FILE="$RUNTIME/.env.release"
RAW_BASE="https://raw.githubusercontent.com/iflytek/skillhub/${PIN}"
CMD="${1:-up}"

require_compose() {
  if docker compose version >/dev/null 2>&1; then
    return
  fi
  echo "docker compose is required to run the SkillHub sidecar." >&2
  exit 1
}

download() {
  local url="$1"
  local dest="$2"
  curl -fsSL "$url" -o "$dest"
  if [ ! -s "$dest" ]; then
    echo "Failed to download $url" >&2
    exit 1
  fi
}

sync_official_files() {
  mkdir -p "$RUNTIME"
  echo "Fetching SkillHub ${PIN} compose files into ${RUNTIME}"
  download "${RAW_BASE}/compose.release.yml" "$COMPOSE"
  download "${RAW_BASE}/.env.release.example" "$ENV_EXAMPLE"
}

apply_overlay() {
  local source="$1"
  local target="$2"
  local tmp
  tmp="$(mktemp)"
  awk -F= -v overlay="$source" '
    BEGIN {
      while ((getline line < overlay) > 0) {
        if (line ~ /^[[:space:]]*#/ || line !~ /=/) continue
        key = line
        sub(/=.*/, "", key)
        values[key] = substr(line, index(line, "=") + 1)
      }
      close(overlay)
    }
    {
      if ($0 ~ /^[[:space:]]*#/ || $0 !~ /=/) { print; next }
      key = $1
      if (key in values) {
        print key "=" values[key]
        seen[key] = 1
        next
      }
      print
    }
    END {
      for (key in values) if (!(key in seen)) print key "=" values[key]
    }
  ' "$target" >"$tmp"
  mv "$tmp" "$target"
}

ensure_env_file() {
  if [ -f "$ENV_FILE" ]; then
    return
  fi
  if [ ! -f "$OVERLAY" ]; then
    echo "Missing overlay $OVERLAY" >&2
    exit 1
  fi
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  apply_overlay "$OVERLAY" "$ENV_FILE"
  echo "Created $ENV_FILE from official example + heihub overlay. Edit passwords before exposing the stack."
}

run_compose() {
  require_compose
  docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE" "$@"
}

case "$CMD" in
  refresh)
    sync_official_files
    ensure_env_file
    ;;
  up)
    if [ ! -f "$COMPOSE" ] || [ ! -f "$ENV_EXAMPLE" ]; then
      sync_official_files
    fi
    ensure_env_file
    run_compose up -d
    cat <<'EOF'

SkillHub sidecar is up.
  UI / SKILLHUB_URL (host):     http://127.0.0.1:18088
  API:                          http://127.0.0.1:18080
  From this repo docker stack:  SKILLHUB_URL=http://host.docker.internal:18088
  From pnpm dev on the host:    SKILLHUB_URL=http://127.0.0.1:18088
EOF
    ;;
  down)
    if [ ! -f "$COMPOSE" ] || [ ! -f "$ENV_FILE" ]; then
      echo "Runtime files are missing. Nothing to stop." >&2
      exit 1
    fi
    run_compose down
    ;;
  ps)
    if [ ! -f "$COMPOSE" ] || [ ! -f "$ENV_FILE" ]; then
      echo "Runtime files are missing. Run up first." >&2
      exit 1
    fi
    run_compose ps
    ;;
  pull)
    if [ ! -f "$COMPOSE" ] || [ ! -f "$ENV_EXAMPLE" ]; then
      sync_official_files
    fi
    ensure_env_file
    run_compose pull
    ;;
  *)
    echo "Usage: $0 [up|down|ps|pull|refresh]" >&2
    exit 1
    ;;
esac
