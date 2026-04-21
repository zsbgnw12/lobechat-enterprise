#!/usr/bin/env bash
# Pilot: prove KB_MOCK=false works end-to-end for kb.search.
# Starts an ephemeral gateway container on $PILOT_PORT (default 3102)
# that shares the main stack's db but uses .env.pilot for upstream keys.
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"          # .../gateway
ROOT="$(cd "$HERE/.." && pwd)"                     # repo root
ENVFILE="$ROOT/.env.pilot"
PILOT_PORT="${PILOT_PORT:-3102}"
PILOT_NAME="${PILOT_NAME:-lobechat-gateway-pilot-kb}"

if [ ! -f "$ENVFILE" ]; then
  echo "missing $ENVFILE"; exit 2
fi

NET="$(docker network ls --format '{{.Name}}' | grep -E '(^|_)lobechat_default$' | head -1)"
if [ -z "$NET" ]; then NET="lobechat_default"; fi

IMG="$(docker inspect -f '{{.Config.Image}}' lobechat-gateway-1 2>/dev/null || echo lobechat-gateway)"

echo "[pilot-kb] image=$IMG net=$NET port=$PILOT_PORT"
docker rm -f "$PILOT_NAME" >/dev/null 2>&1 || true

docker run -d --name "$PILOT_NAME" \
  --network "$NET" \
  --env-file "$ENVFILE" \
  -e API_PORT=3001 \
  -e NODE_ENV=development \
  -e DATABASE_URL="postgresql://eg:eg_pw@db:5432/enterprise_gateway?schema=public" \
  -p "$PILOT_PORT:3001" \
  "$IMG" >/dev/null

cleanup() { docker rm -f "$PILOT_NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

for i in $(seq 1 30); do
  if curl -sf "http://localhost:$PILOT_PORT/health" >/dev/null; then break; fi
  sleep 1
done
curl -sf "http://localhost:$PILOT_PORT/health" >/dev/null || { echo "[pilot-kb] gateway unhealthy"; docker logs "$PILOT_NAME" | tail -40; exit 3; }

mock_state="$(docker exec "$PILOT_NAME" sh -c 'echo KB_MOCK=$KB_MOCK KB_AGENT_URL=$KB_AGENT_URL' || true)"
echo "[pilot-kb] env: $mock_state"

QUERY="Taiji Agent 产品规划 $(date +%s)"
echo "[pilot-kb] POST /api/tools/call  tool=kb.search user=tech1 (call 1)"
http_code="$(curl -s -o /tmp/pilot-kb-1.json -w "%{http_code}" -X POST \
  "http://localhost:$PILOT_PORT/api/tools/call" \
  -H "x-dev-user: tech1" -H "content-type: application/json" \
  -d "{\"tool\":\"kb.search\",\"params\":{\"query\":\"$QUERY\",\"top\":3}}")"
body1="$(cat /tmp/pilot-kb-1.json)"
echo "[pilot-kb] http1=$http_code"
echo "[pilot-kb] body1: $body1" | head -c 1500; echo

if [ "$http_code" != "200" ]; then
  echo "[pilot-kb] FAIL: upstream unreachable or gateway error (http=$http_code)"
  docker logs "$PILOT_NAME" 2>&1 | tail -40
  exit 1
fi

cached1="$(echo "$body1" | python3 -c "import json,sys;d=json.load(sys.stdin);r=d.get('data') or {};m=(r.get('meta') if isinstance(r,dict) else None) or d.get('meta') or {};print(m.get('cached','?'))" 2>/dev/null || echo ?)"
attempts1="$(echo "$body1" | python3 -c "import json,sys;d=json.load(sys.stdin);r=d.get('data') or {};m=(r.get('meta') if isinstance(r,dict) else None) or d.get('meta') or {};print(m.get('attempts','?'))" 2>/dev/null || echo ?)"
echo "[pilot-kb] call1 meta.cached=$cached1 meta.attempts=$attempts1"

echo "[pilot-kb] POST /api/tools/call  tool=kb.search user=tech1 (call 2 — cache hit expected)"
http_code2="$(curl -s -o /tmp/pilot-kb-2.json -w "%{http_code}" -X POST \
  "http://localhost:$PILOT_PORT/api/tools/call" \
  -H "x-dev-user: tech1" -H "content-type: application/json" \
  -d "{\"tool\":\"kb.search\",\"params\":{\"query\":\"$QUERY\",\"top\":3}}")"
body2="$(cat /tmp/pilot-kb-2.json)"
echo "[pilot-kb] http2=$http_code2"
echo "[pilot-kb] body2: $body2" | head -c 1500; echo
cached2="$(echo "$body2" | python3 -c "import json,sys;d=json.load(sys.stdin);r=d.get('data') or {};m=(r.get('meta') if isinstance(r,dict) else None) or d.get('meta') or {};print(m.get('cached','?'))" 2>/dev/null || echo ?)"
echo "[pilot-kb] call2 meta.cached=$cached2"

if [ "$cached2" = "True" ] || [ "$cached2" = "true" ]; then
  echo "[pilot-kb] PASS — second call served from cache"
else
  echo "[pilot-kb] WARN — second call meta.cached=$cached2 (expected true)"
fi
echo "[pilot-kb] OK — kb upstream reachable"
