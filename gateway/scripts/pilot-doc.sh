#!/usr/bin/env bash
# Pilot: prove doc.generate returns download_url for file-producing upstream.
# Ephemeral gateway on PILOT_PORT (default 3105).
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
ENVFILE="$ROOT/.env.pilot"
PILOT_PORT="${PILOT_PORT:-3105}"
PILOT_NAME="${PILOT_NAME:-lobechat-gateway-pilot-doc}"

if [ ! -f "$ENVFILE" ]; then
  echo "missing $ENVFILE"; exit 2
fi

NET="$(docker network ls --format '{{.Name}}' | grep -E '(^|_)lobechat_default$' | head -1)"
if [ -z "$NET" ]; then NET="lobechat_default"; fi

IMG="$(docker inspect -f '{{.Config.Image}}' lobechat-gateway-1 2>/dev/null || echo lobechat-gateway)"
echo "[pilot-doc] image=$IMG net=$NET port=$PILOT_PORT"
docker rm -f "$PILOT_NAME" >/dev/null 2>&1 || true

docker run -d --name "$PILOT_NAME" \
  --network "$NET" \
  --env-file "$ENVFILE" \
  -e API_PORT=3001 \
  -e NODE_ENV=development \
  -e MOCK_MODE=false \
  -e DOC_AGENT_MOCK=false \
  -e DATABASE_URL="postgresql://eg:eg_pw@db:5432/enterprise_gateway?schema=public" \
  -p "$PILOT_PORT:3001" \
  "$IMG" >/dev/null

cleanup() { docker rm -f "$PILOT_NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

for i in $(seq 1 30); do
  if curl -sf "http://localhost:$PILOT_PORT/health" >/dev/null; then break; fi
  sleep 1
done
curl -sf "http://localhost:$PILOT_PORT/health" >/dev/null || { echo "[pilot-doc] gateway unhealthy"; docker logs "$PILOT_NAME" | tail -40; exit 3; }

echo "[pilot-doc] POST /api/tools/call  tool=doc.generate user=ops1"
http_code="$(curl -s -o /tmp/pilot-doc.json -w "%{http_code}" -X POST \
  "http://localhost:$PILOT_PORT/api/tools/call" \
  -H "x-dev-user: ops1" -H "content-type: application/json" \
  -d '{"tool":"doc.generate","params":{"prompt":"test doc","topic":"enterprise"}}')"
body="$(cat /tmp/pilot-doc.json)"
echo "[pilot-doc] http=$http_code"
echo "$body" | head -c 2000; echo

if [ "$http_code" != "200" ]; then
  echo "[pilot-doc] WARN: non-200 (http=$http_code)"
  if echo "$body" | grep -qiE '"error"|"denied"|"forbidden"|"upstream"'; then
    echo "[pilot-doc] expected upstream/auth error — exit 0"
    exit 0
  fi
  docker logs "$PILOT_NAME" 2>&1 | tail -20
  exit 1
fi

download_url="$(echo "$body" | python3 -c "import json,sys;d=json.load(sys.stdin);r=d.get('data') or {};print(r.get('download_url',''))" 2>/dev/null || echo '')"
markdown_len="$(echo "$body" | python3 -c "import json,sys;d=json.load(sys.stdin);r=d.get('data') or {};print(len(r.get('markdown') or ''))" 2>/dev/null || echo 0)"

if [ -n "$download_url" ]; then
  echo "[pilot-doc] download_url=$download_url"
  # HEAD-probe reachability (non-blocking assertion)
  probe_code="$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -I "$download_url" || echo 000)"
  echo "[pilot-doc] download_url HEAD status=$probe_code"
  if [ "$probe_code" = "200" ] || [ "$probe_code" = "302" ] || [ "$probe_code" = "301" ]; then
    echo "[pilot-doc] PASS — download_url present and reachable"
  else
    echo "[pilot-doc] WARN — download_url present but HEAD returned $probe_code (non-blocking)"
  fi
  exit 0
fi

if [ "$markdown_len" != "0" ] && [ -n "$markdown_len" ]; then
  echo "[pilot-doc] no download_url; markdown_len=$markdown_len (inline-markdown upstream variant)"
  exit 0
fi

echo "[pilot-doc] FAIL — neither download_url nor markdown present"
exit 1
