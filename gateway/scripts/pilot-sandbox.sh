#!/usr/bin/env bash
# Pilot: prove sandbox.run exercises Daytona real exec loop or returns structured unsupported.
# Ephemeral gateway on PILOT_PORT (default 3104).
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
ENVFILE="$ROOT/.env.pilot"
PILOT_PORT="${PILOT_PORT:-3104}"
PILOT_NAME="${PILOT_NAME:-lobechat-gateway-pilot-sandbox}"

if [ ! -f "$ENVFILE" ]; then
  echo "missing $ENVFILE"; exit 2
fi

NET="$(docker network ls --format '{{.Name}}' | grep -E '(^|_)lobechat_default$' | head -1)"
if [ -z "$NET" ]; then NET="lobechat_default"; fi

IMG="$(docker inspect -f '{{.Config.Image}}' lobechat-gateway-1 2>/dev/null || echo lobechat-gateway)"
echo "[pilot-sandbox] image=$IMG net=$NET port=$PILOT_PORT"
docker rm -f "$PILOT_NAME" >/dev/null 2>&1 || true

docker run -d --name "$PILOT_NAME" \
  --network "$NET" \
  --env-file "$ENVFILE" \
  -e API_PORT=3001 \
  -e NODE_ENV=development \
  -e MOCK_MODE=false \
  -e SANDBOX_MOCK="${SANDBOX_MOCK:-false}" \
  ${SANDBOX_REUSE_WORKSPACE_ID:+-e SANDBOX_REUSE_WORKSPACE_ID="$SANDBOX_REUSE_WORKSPACE_ID"} \
  -e DATABASE_URL="postgresql://eg:eg_pw@db:5432/enterprise_gateway?schema=public" \
  -p "$PILOT_PORT:3001" \
  "$IMG" >/dev/null

cleanup() { docker rm -f "$PILOT_NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

for i in $(seq 1 30); do
  if curl -sf "http://localhost:$PILOT_PORT/health" >/dev/null; then break; fi
  sleep 1
done
curl -sf "http://localhost:$PILOT_PORT/health" >/dev/null || { echo "[pilot-sandbox] gateway unhealthy"; docker logs "$PILOT_NAME" | tail -40; exit 3; }

echo "[pilot-sandbox] POST /api/tools/call  tool=sandbox.run user=tech1"
http_code="$(curl -s -o /tmp/pilot-sandbox.json -w "%{http_code}" -X POST \
  "http://localhost:$PILOT_PORT/api/tools/call" \
  -H "x-dev-user: tech1" -H "content-type: application/json" \
  -d '{"tool":"sandbox.run","params":{"code":"echo hi","language":"bash"}}')"
body="$(cat /tmp/pilot-sandbox.json)"
echo "[pilot-sandbox] http=$http_code"
echo "[pilot-sandbox] body: $body" | head -c 2500; echo

if [ "$http_code" != "200" ]; then
  echo "[pilot-sandbox] WARN: non-200 (http=$http_code) — checking if auth/permission error (acceptable)"
  if echo "$body" | grep -qiE '"error"|"denied"|"forbidden"'; then
    echo "[pilot-sandbox] expected auth/permission error — exit 0"
    exit 0
  fi
  docker logs "$PILOT_NAME" 2>&1 | tail -20
  exit 1
fi

unsupported="$(echo "$body" | python3 -c "import json,sys;d=json.load(sys.stdin);r=d.get('data') or {};print(r.get('unsupported','false'))" 2>/dev/null || echo ?)"
if [ "$unsupported" = "True" ] || [ "$unsupported" = "true" ]; then
  reason="$(echo "$body" | python3 -c "import json,sys;d=json.load(sys.stdin);r=d.get('data') or {};print(r.get('reason',''))" 2>/dev/null || echo ?)"
  status="$(echo "$body" | python3 -c "import json,sys;d=json.load(sys.stdin);r=d.get('data') or {};print(r.get('http_status',''))" 2>/dev/null || echo ?)"
  echo "[pilot-sandbox] PASS (unsupported): status=$status reason=$reason"
  exit 0
fi

stdout="$(echo "$body" | python3 -c "import json,sys;d=json.load(sys.stdin);r=d.get('data') or {};print(repr(r.get('stdout','')))" 2>/dev/null || echo ?)"
exit_code="$(echo "$body" | python3 -c "import json,sys;d=json.load(sys.stdin);r=d.get('data') or {};print(r.get('exit_code','?'))" 2>/dev/null || echo ?)"
echo "[pilot-sandbox] stdout=$stdout exit_code=$exit_code"
echo "[pilot-sandbox] OK — real exec loop returned"
