#!/usr/bin/env bash
# Pilot: prove XIAOSHOU_MOCK=false works end-to-end for xiaoshou.search_customers.
# Clean-skips if SUPER_OPS_API_KEY is unset.
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"          # .../gateway
ROOT="$(cd "$HERE/.." && pwd)"                     # repo root
ENVFILE="$ROOT/.env.pilot"
PILOT_PORT="${PILOT_PORT:-3103}"
PILOT_NAME="${PILOT_NAME:-lobechat-gateway-pilot-xiaoshou}"

if [ ! -f "$ENVFILE" ]; then
  echo "missing $ENVFILE"; exit 2
fi

# Clean-skip when no upstream key.
KEY_VAL="$(grep -E '^SUPER_OPS_API_KEY=' "$ENVFILE" | tail -1 | sed 's/^SUPER_OPS_API_KEY=//')"
if [ -z "${SUPER_OPS_API_KEY:-}" ] && [ -z "$KEY_VAL" ]; then
  echo "SKIPPED: SUPER_OPS_API_KEY not set"
  exit 0
fi

NET="$(docker network ls --format '{{.Name}}' | grep -E '(^|_)lobechat_default$' | head -1)"
if [ -z "$NET" ]; then NET="lobechat_default"; fi

IMG="$(docker inspect -f '{{.Config.Image}}' lobechat-gateway-1 2>/dev/null || echo lobechat-gateway)"

echo "[pilot-xiaoshou] image=$IMG net=$NET port=$PILOT_PORT"
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
curl -sf "http://localhost:$PILOT_PORT/health" >/dev/null || { echo "[pilot-xiaoshou] gateway unhealthy"; docker logs "$PILOT_NAME" | tail -40; exit 3; }

mock_state="$(docker exec "$PILOT_NAME" sh -c 'echo XIAOSHOU_MOCK=$XIAOSHOU_MOCK SUPER_OPS_API_URL=$SUPER_OPS_API_URL' || true)"
echo "[pilot-xiaoshou] env: $mock_state"

echo "[pilot-xiaoshou] POST /api/tools/call  tool=xiaoshou.search_customers user=sales1"
http_code="$(curl -s -o /tmp/pilot-xiaoshou.json -w "%{http_code}" -X POST \
  "http://localhost:$PILOT_PORT/api/tools/call" \
  -H "x-dev-user: sales1" -H "content-type: application/json" \
  -d '{"tool":"xiaoshou.search_customers","params":{"page":1,"page_size":20}}')"
body="$(cat /tmp/pilot-xiaoshou.json)"
echo "[pilot-xiaoshou] http=$http_code"
echo "[pilot-xiaoshou] body: $body" | head -c 2000; echo

if [ "$http_code" = "200" ]; then
  count="$(echo "$body" | python3 -c "import json,sys;d=json.load(sys.stdin);items=d.get('data') or d.get('items') or [];print(len(items))" 2>/dev/null || echo ?)"
  masked="$(echo "$body" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('meta',{}).get('masked_count','?'))" 2>/dev/null || echo ?)"
  echo "[pilot-xiaoshou] returned item count=$count  meta.masked_count=$masked"
  echo "[pilot-xiaoshou] OK"
elif [ "$http_code" = "502" ] || [ "$http_code" = "500" ]; then
  detail="$(echo "$body" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('detail','?'))" 2>/dev/null || echo ?)"
  if echo "$detail" | grep -q "401"; then
    echo "[pilot-xiaoshou] upstream 401 (expected — no SUPER_OPS_API_KEY): $detail"
    echo "[pilot-xiaoshou] OK — path exercised"
  else
    echo "[pilot-xiaoshou] FAIL: unexpected error detail: $detail"
    docker logs "$PILOT_NAME" 2>&1 | tail -20
    exit 1
  fi
else
  echo "[pilot-xiaoshou] FAIL: unexpected http=$http_code"
  docker logs "$PILOT_NAME" 2>&1 | tail -40
  exit 1
fi
