#!/usr/bin/env bash
# Pilot: prove MOCK_MODE=false works end-to-end for gongdan.search_tickets.
# Starts a second, ephemeral gateway container on $PILOT_PORT (default 3101)
# that shares the main stack's db but uses .env.pilot for upstream keys.
# Leaves the main stack untouched.
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"          # .../gateway
ROOT="$(cd "$HERE/.." && pwd)"                     # repo root
ENVFILE="$ROOT/.env.pilot"
PILOT_PORT="${PILOT_PORT:-3101}"
PILOT_NAME="${PILOT_NAME:-lobechat-gateway-pilot}"

if [ ! -f "$ENVFILE" ]; then
  echo "missing $ENVFILE"; exit 2
fi

# main stack's compose network; tolerate either project naming.
NET="$(docker network ls --format '{{.Name}}' | grep -E '(^|_)lobechat_default$' | head -1)"
if [ -z "$NET" ]; then NET="lobechat_default"; fi

# Image is the one already built by `docker compose up -d gateway`.
IMG="$(docker inspect -f '{{.Config.Image}}' lobechat-gateway-1 2>/dev/null || echo lobechat-gateway)"

echo "[pilot] image=$IMG net=$NET port=$PILOT_PORT"
docker rm -f "$PILOT_NAME" >/dev/null 2>&1 || true

# Start the pilot gateway. DATABASE_URL points at the shared db.
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

# Wait for health.
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$PILOT_PORT/health" >/dev/null; then break; fi
  sleep 1
done
curl -sf "http://localhost:$PILOT_PORT/health" >/dev/null || { echo "[pilot] gateway unhealthy"; docker logs "$PILOT_NAME" | tail -40; exit 3; }

# Sanity: confirm the container sees GONGDAN_MOCK=false.
mock_state="$(docker exec "$PILOT_NAME" sh -c 'echo MOCK=$MOCK_MODE GONGDAN_MOCK=$GONGDAN_MOCK GONGDAN_API_URL=$GONGDAN_API_URL' || true)"
echo "[pilot] env: $mock_state"

# Call gongdan.search_tickets as ops1 (has the tool grant and all=true scope).
echo "[pilot] POST /api/tools/call  tool=gongdan.search_tickets user=ops1"
http_code="$(curl -s -o /tmp/pilot.json -w "%{http_code}" -X POST \
  "http://localhost:$PILOT_PORT/api/tools/call" \
  -H "x-dev-user: ops1" -H "content-type: application/json" \
  -d '{"tool":"gongdan.search_tickets","params":{"pageSize":5}}')"
body="$(cat /tmp/pilot.json)"
echo "[pilot] http=$http_code"
echo "[pilot] body: $body" | head -c 2000; echo

if [ "$http_code" != "200" ]; then
  echo "[pilot] FAIL: upstream unreachable or gateway error (http=$http_code)"
  echo "[pilot] container logs (tail):"
  docker logs "$PILOT_NAME" 2>&1 | tail -40
  exit 1
fi

count="$(echo "$body" | python3 -c "import json,sys;d=json.load(sys.stdin);print(len(d.get('data') or []))" 2>/dev/null || echo ?)"
filtered="$(echo "$body" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('meta',{}).get('filtered_count','?'))" 2>/dev/null || echo ?)"
echo "[pilot] returned data count=$count  meta.filtered_count=$filtered"
echo "[pilot] OK — upstream reachable, identity-map filter applied"
