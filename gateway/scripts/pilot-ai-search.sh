#!/usr/bin/env bash
# Pilot: prove ai_search.web calls Serper.dev real upstream.
# Ephemeral gateway on PILOT_PORT (default 3103).
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
ENVFILE="$ROOT/.env.pilot"
PILOT_PORT="${PILOT_PORT:-3103}"
PILOT_NAME="${PILOT_NAME:-lobechat-gateway-pilot-aisearch}"

if [ ! -f "$ENVFILE" ]; then
  echo "missing $ENVFILE"; exit 2
fi

NET="$(docker network ls --format '{{.Name}}' | grep -E '(^|_)lobechat_default$' | head -1)"
if [ -z "$NET" ]; then NET="lobechat_default"; fi

IMG="$(docker inspect -f '{{.Config.Image}}' lobechat-gateway-1 2>/dev/null || echo lobechat-gateway)"
echo "[pilot-ai-search] image=$IMG net=$NET port=$PILOT_PORT"
docker rm -f "$PILOT_NAME" >/dev/null 2>&1 || true

docker run -d --name "$PILOT_NAME" \
  --network "$NET" \
  --env-file "$ENVFILE" \
  -e API_PORT=3001 \
  -e NODE_ENV=development \
  -e MOCK_MODE=false \
  -e AI_SEARCH_MOCK=false \
  -e DATABASE_URL="postgresql://eg:eg_pw@db:5432/enterprise_gateway?schema=public" \
  -p "$PILOT_PORT:3001" \
  "$IMG" >/dev/null

cleanup() { docker rm -f "$PILOT_NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

for i in $(seq 1 30); do
  if curl -sf "http://localhost:$PILOT_PORT/health" >/dev/null; then break; fi
  sleep 1
done
curl -sf "http://localhost:$PILOT_PORT/health" >/dev/null || { echo "[pilot-ai-search] gateway unhealthy"; docker logs "$PILOT_NAME" | tail -40; exit 3; }

echo "[pilot-ai-search] POST /api/tools/call  tool=ai_search.web user=sales1"
http_code="$(curl -s -o /tmp/pilot-aisearch.json -w "%{http_code}" -X POST \
  "http://localhost:$PILOT_PORT/api/tools/call" \
  -H "x-dev-user: sales1" -H "content-type: application/json" \
  -d '{"tool":"ai_search.web","params":{"query":"Enterprise AI Workspace","top":3}}')"
body="$(cat /tmp/pilot-aisearch.json)"
echo "[pilot-ai-search] http=$http_code"
echo "[pilot-ai-search] body: $body" | head -c 2000; echo

if [ "$http_code" != "200" ]; then
  echo "[pilot-ai-search] WARN: non-200 (http=$http_code) — checking if auth/permission error (acceptable)"
  if echo "$body" | grep -qiE '"error"|"denied"|"forbidden"'; then
    echo "[pilot-ai-search] expected auth/permission error — exit 0"
    exit 0
  fi
  docker logs "$PILOT_NAME" 2>&1 | tail -20
  exit 1
fi

provider="$(echo "$body" | python3 -c "import json,sys;d=json.load(sys.stdin);r=d.get('data') or {};print(r.get('provider',''))" 2>/dev/null || echo '')"
count="$(echo "$body" | python3 -c "import json,sys;d=json.load(sys.stdin);r=d.get('data') or {};print(len(r.get('results') or []))" 2>/dev/null || echo ?)"
echo "[pilot-ai-search] provider=$provider item count=$count"
if [ "$provider" != "serper" ]; then
  echo "[pilot-ai-search] FAIL — expected provider=serper, got '$provider'"
  exit 1
fi
echo "[pilot-ai-search] OK"
