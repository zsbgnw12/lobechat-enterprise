#!/usr/bin/env bash
# pilot-casdoor.sh
# End-to-end pilot for the Casdoor JWKS Bearer middleware, decoupled from the
# main acceptance suite so acceptance.sh stays fast and can run without docker
# reconfiguration.
#
# Flow:
#   1) start a tiny Node HTTP server that (a) generates an RSA keypair,
#      (b) serves /.well-known/jwks.json, (c) mints a JWT for an inline request
#   2) rebuild & restart gateway with AUTH_MODE=casdoor + CASDOOR_URL pointing at the mock
#   3) curl GET /api/me with the Bearer token -> expect 200 + matching claims
#   4) restore AUTH_MODE=dev and restart gateway
#
# Exit code 0 = pass. Non-zero = fail. Prints a short human-readable report.
set -o pipefail
MOCK_PID=

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

API="${API:-http://localhost:3001}"
MOCK_PORT="${MOCK_PORT:-4555}"
MOCK_CONTAINER_HOST="host.docker.internal"   # how gateway container reaches host
MOCK_URL_HOST="http://localhost:${MOCK_PORT}" # how host curl reaches the mock
MOCK_URL_CONTAINER="http://${MOCK_CONTAINER_HOST}:${MOCK_PORT}"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"; kill $MOCK_PID 2>/dev/null || true' EXIT

cat > "$WORK/mock-idp.js" <<'JS'
// Tiny mock OIDC issuer: generates RSA keypair, serves JWKS, mints JWT on /mint.
const http = require('http');
const crypto = require('crypto');
const { SignJWT, exportJWK } = require('/app/node_modules/jose');

const port = parseInt(process.env.MOCK_PORT || '4555', 10);
const issuer = process.env.MOCK_ISSUER || `http://host.docker.internal:${port}`;

(async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pubJwk = await exportJWK(publicKey);
  pubJwk.kid = 'pilot-1';
  pubJwk.use = 'sig';
  pubJwk.alg = 'RS256';

  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/.well-known/jwks.json')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [pubJwk] }));
      return;
    }
    if (req.url.startsWith('/mint')) {
      const sub = 'pilot-sub-1';
      const jwt = await new SignJWT({
        preferred_username: 'pilot_user',
        name: 'Pilot User',
        email: 'pilot@example.com',
        roles: ['super_admin'],
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'pilot-1' })
        .setSubject(sub)
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ token: jwt, sub }));
      return;
    }
    res.writeHead(404); res.end();
  });
  server.listen(port, '0.0.0.0', () => {
    console.error(`mock-idp listening on :${port} issuer=${issuer}`);
  });
})().catch(e => { console.error(e); process.exit(1); });
JS

echo "[pilot-casdoor] starting mock IdP on :$MOCK_PORT (inside gateway container)"
# Run the mock inside the gateway container so "jose" is available and so the
# gateway can reach it over its network without host.docker.internal gymnastics.
docker exec -d -e MOCK_PORT="$MOCK_PORT" \
  -e MOCK_ISSUER="http://localhost:$MOCK_PORT" \
  lobechat-gateway-1 sh -c "node /tmp/mock-idp.js > /tmp/mock-idp.log 2>&1 &"

docker cp "$WORK/mock-idp.js" lobechat-gateway-1:/tmp/mock-idp.js
docker exec -d -e MOCK_PORT="$MOCK_PORT" \
  -e MOCK_ISSUER="http://localhost:$MOCK_PORT" \
  lobechat-gateway-1 node /tmp/mock-idp.js

# Wait for mock inside container
for i in $(seq 1 20); do
  if docker exec lobechat-gateway-1 wget -qO- "http://localhost:$MOCK_PORT/.well-known/jwks.json" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
if ! docker exec lobechat-gateway-1 wget -qO- "http://localhost:$MOCK_PORT/.well-known/jwks.json" >/dev/null 2>&1; then
  echo "[pilot-casdoor] FAIL: mock IdP did not come up"; exit 1
fi

# Mint a token via the mock (from inside the container so host networking is irrelevant)
MINT_JSON=$(docker exec lobechat-gateway-1 wget -qO- "http://localhost:$MOCK_PORT/mint")
TOKEN=$(echo "$MINT_JSON" | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")
SUB=$(echo "$MINT_JSON"   | python3 -c "import json,sys;print(json.load(sys.stdin)['sub'])")
[ -n "$TOKEN" ] || { echo "[pilot-casdoor] FAIL: could not mint token"; exit 1; }

echo "[pilot-casdoor] switching gateway to AUTH_MODE=casdoor"
docker exec lobechat-gateway-1 sh -c "true"  # ensure reachable
# Write a short-lived override .env style via docker compose env_file is heavy;
# instead, restart gateway with env vars injected through docker exec + supervisord
# would require a full rebuild. For this pilot we instead re-run acceptance via
# a side-car container that reuses the same image.

docker run --rm --network lobechat_default \
  -e AUTH_MODE=casdoor \
  -e NODE_ENV=development \
  -e DATABASE_URL="postgresql://eg:eg_pw@db:5432/enterprise_gateway?schema=public" \
  -e CASDOOR_URL="http://lobechat-gateway-1:$MOCK_PORT" \
  -e CASDOOR_JWKS_URL="http://lobechat-gateway-1:$MOCK_PORT/.well-known/jwks.json" \
  -e CASDOOR_ISSUER="http://localhost:$MOCK_PORT" \
  -e API_PORT=3101 \
  -p 3101:3101 \
  --name lobechat-gateway-pilot \
  -d lobechat-gateway >/dev/null

# Wait for pilot gateway
for i in $(seq 1 40); do
  if curl -sf http://localhost:3101/health >/dev/null 2>&1; then break; fi
  sleep 0.5
done
if ! curl -sf http://localhost:3101/health >/dev/null 2>&1; then
  echo "[pilot-casdoor] FAIL: pilot gateway never became healthy"
  docker logs --tail 80 lobechat-gateway-pilot || true
  docker rm -f lobechat-gateway-pilot >/dev/null 2>&1 || true
  exit 1
fi

resp_code=$(curl -s -o /tmp/pilot-me.json -w "%{http_code}" -H "Authorization: Bearer $TOKEN" http://localhost:3101/api/me)
cat /tmp/pilot-me.json
docker rm -f lobechat-gateway-pilot >/dev/null 2>&1 || true
# Stop mock
docker exec lobechat-gateway-1 pkill -f mock-idp.js 2>/dev/null || true

if [ "$resp_code" != "200" ]; then
  echo "[pilot-casdoor] FAIL: /api/me status=$resp_code"
  exit 1
fi
if ! grep -q "\"casdoor_sub\":\"$SUB\"" /tmp/pilot-me.json; then
  echo "[pilot-casdoor] FAIL: casdoor_sub mismatch"
  exit 1
fi
echo "[pilot-casdoor] PASS: /api/me returned 200 with casdoor_sub=$SUB"
exit 0
