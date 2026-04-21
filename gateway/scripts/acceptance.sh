#!/usr/bin/env bash
# Acceptance tests for Enterprise Gateway — runs against localhost:3001.
# Exit code 0 = all pass.
set -u
API="${API:-http://localhost:3001}"
pass=0; fail=0
declare -a results

hdr() {
  local user="$1"
  echo -n "-H x-dev-user:$user -H content-type:application/json"
}

check() {
  local name="$1" ok="$2" detail="$3"
  if [ "$ok" = "1" ]; then
    pass=$((pass+1)); results+=("PASS  $name")
    echo "PASS  $name"
  else
    fail=$((fail+1)); results+=("FAIL  $name -- $detail")
    echo "FAIL  $name -- $detail"
  fi
}

# Wait for health
for i in $(seq 1 40); do
  if curl -sf "$API/health" >/dev/null; then break; fi
  sleep 1
done
curl -sf "$API/health" >/dev/null || { echo "API not healthy"; exit 2; }

# Reset state added by prior acceptance runs so T4/T12 remain deterministic.
docker exec lobechat-db-1 psql -U eg -d enterprise_gateway -c \
  "DELETE FROM enterprise_identity_map WHERE source_system='synthetic' OR (source_system='gongdan' AND source_entity_id='T-900');" \
  >/dev/null 2>&1 || true

# --- Test 1: customer calls xiaoshou.search_customers -> 403 ---
resp=$(curl -s -o /tmp/t1.json -w "%{http_code}" -X POST "$API/api/tools/call" \
  -H "x-dev-user: cust1" -H "content-type: application/json" \
  -d '{"tool":"xiaoshou.search_customers","params":{}}')
if [ "$resp" = "403" ]; then check "T1 customer deny xiaoshou.search_customers" 1 ""
else check "T1 customer deny xiaoshou.search_customers" 0 "status=$resp body=$(cat /tmp/t1.json)"; fi

# audit row for deny
audit=$(curl -s "$API/api/admin/audit?user=cust1&tool=xiaoshou.search_customers&outcome=denied" -H "x-dev-user: sa")
if echo "$audit" | grep -q '"outcome":"denied"'; then check "T1a audit deny row" 1 ""
else check "T1a audit deny row" 0 "$audit"; fi

# --- Test 2: permission_admin calling gongdan.search_tickets -> 403 ---
resp=$(curl -s -o /tmp/t2.json -w "%{http_code}" -X POST "$API/api/tools/call" \
  -H "x-dev-user: pa" -H "content-type: application/json" \
  -d '{"tool":"gongdan.search_tickets","params":{}}')
if [ "$resp" = "403" ]; then check "T2 permission_admin deny gongdan.search_tickets" 1 ""
else check "T2 permission_admin deny gongdan.search_tickets" 0 "status=$resp body=$(cat /tmp/t2.json)"; fi

# --- Test 3: internal_sales calling xiaoshou.search_customers -> only own ---
body=$(curl -s -X POST "$API/api/tools/call" \
  -H "x-dev-user: sales1" -H "content-type: application/json" \
  -d '{"tool":"xiaoshou.search_customers","params":{}}')
kept=$(echo "$body" | python3 -c "import json,sys;d=json.load(sys.stdin);print(len(d.get('data',[])))" 2>/dev/null || echo 0)
dropped=$(echo "$body" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('meta',{}).get('dropped_count',0))" 2>/dev/null || echo 0)
# CUST-0001, CUST-0003, CUST-0005 belong to sales1 -> 3 kept, 2 dropped
if [ "$kept" = "3" ] && [ "$dropped" = "2" ]; then check "T3 internal_sales filter (3 kept / 2 dropped)" 1 ""
else check "T3 internal_sales filter (3 kept / 2 dropped)" 0 "kept=$kept dropped=$dropped body=$body"; fi

# --- Test 4: internal_ops calling gongdan.search_tickets -> T-900 absent, missing_identity_map audit ---
body=$(curl -s -X POST "$API/api/tools/call" \
  -H "x-dev-user: ops1" -H "content-type: application/json" \
  -d '{"tool":"gongdan.search_tickets","params":{}}')
has_t900=$(echo "$body" | grep -c '"id":"T-900"' || true)
miss=$(echo "$body" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('meta',{}).get('missing_identity_map_count',0))" 2>/dev/null || echo 0)
if [ "$has_t900" = "0" ] && [ "$miss" -ge "1" ]; then check "T4 ops missing_identity_map drops T-900" 1 ""
else check "T4 ops missing_identity_map drops T-900" 0 "has_t900=$has_t900 miss=$miss body=$body"; fi
audit_miss=$(curl -s "$API/api/admin/audit?user=ops1&outcome=ok" -H "x-dev-user: sa")
if echo "$audit_miss" | grep -q 'missing_identity_map'; then check "T4a audit has missing_identity_map entry" 1 ""
else check "T4a audit has missing_identity_map entry" 0 ""; fi

# --- Test 5: customer calling gongdan.get_own_tickets -> only own & contactInfo masked ---
body=$(curl -s -X POST "$API/api/tools/call" \
  -H "x-dev-user: cust1" -H "content-type: application/json" \
  -d '{"tool":"gongdan.get_own_tickets","params":{}}')
# should not contain any raw email (contactInfo is masked to ***)
leaked=$(echo "$body" | grep -cE '"contactInfo":"[^*]' || true)
if [ "$leaked" = "0" ]; then check "T5 customer contactInfo masked" 1 ""
else check "T5 customer contactInfo masked" 0 "body=$body"; fi
# only own-customer tickets visible (CUST-0001 rows). No tickets for CUST-0002/0003/etc
foreign=$(echo "$body" | grep -cE '"customer_id":"CUST-000[2-9]"' || true)
if [ "$foreign" = "0" ]; then check "T5a customer sees only own tickets" 1 ""
else check "T5a customer sees only own tickets" 0 "body=$body"; fi

# --- Test 6: super_admin sees audit rows ---
audit_all=$(curl -s "$API/api/admin/audit" -H "x-dev-user: sa")
count=$(echo "$audit_all" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)
if [ "$count" -ge "5" ]; then check "T6 super_admin audit ($count rows)" 1 ""
else check "T6 super_admin audit ($count rows)" 0 "$audit_all"; fi

# --- Test 7: no apiKey/secret in any non-super_admin response (scan several tools) ---
leak=0
for user in cust1 sales1 ops1 tech1 pa; do
  for t in 'gongdan.get_own_tickets' 'gongdan.search_tickets' 'xiaoshou.search_customers' 'cloudcost.get_overview'; do
    b=$(curl -s -X POST "$API/api/tools/call" -H "x-dev-user: $user" -H "content-type: application/json" -d "{\"tool\":\"$t\",\"params\":{}}")
    if echo "$b" | grep -qiE '"(apiKey|api_key|secret[_a-z]*)"'; then
      echo "    LEAK user=$user tool=$t body=$b"
      leak=$((leak+1))
    fi
  done
done
if [ "$leak" = "0" ]; then check "T7 no apiKey/secret leaks to non-super_admin" 1 ""
else check "T7 no apiKey/secret leaks to non-super_admin" 0 "leaks=$leak"; fi

# --- Test 8: customer calling gongdan.update_ticket -> 403 (no grant) ---
resp=$(curl -s -o /tmp/t8.json -w "%{http_code}" -X POST "$API/api/tools/call" \
  -H "x-dev-user: cust1" -H "content-type: application/json" \
  -d '{"tool":"gongdan.update_ticket","params":{"ticketId":"T-001","status":"closed"}}')
if [ "$resp" = "403" ]; then check "T8 customer deny gongdan.update_ticket" 1 ""
else check "T8 customer deny gongdan.update_ticket" 0 "status=$resp body=$(cat /tmp/t8.json)"; fi

# --- Test 9: super_admin calling gongdan.update_ticket succeeds in MOCK_MODE ---
body=$(curl -s -X POST "$API/api/tools/call" \
  -H "x-dev-user: sa" -H "content-type: application/json" \
  -d '{"tool":"gongdan.update_ticket","params":{"ticketId":"T-001","status":"closed"}}')
if echo "$body" | grep -q '"updated":true'; then check "T9 super_admin gongdan.update_ticket success" 1 ""
else check "T9 super_admin gongdan.update_ticket success" 0 "body=$body"; fi

# --- Test 10: dynamic LobeChat manifest is identity-aware (sales1) ---
body=$(curl -s -H "x-dev-user: sales1" "$API/api/lobechat/manifest")
has_xiaoshou=$(echo "$body" | grep -c '"xiaoshou__search_customers"' || true)
has_search_tickets=$(echo "$body" | grep -c '"gongdan__search_tickets"' || true)
if [ "$has_xiaoshou" -ge "1" ] && [ "$has_search_tickets" = "0" ]; then
  check "T10 lobechat manifest scoped to sales1 caps" 1 ""
else
  check "T10 lobechat manifest scoped to sales1 caps" 0 "xs=$has_xiaoshou gd=$has_search_tickets body=$(echo "$body" | head -c 400)"
fi

# --- Test 11: tool-gateway enforces authz (cust1 kb ok, xiaoshou denied) ---
ok_body=$(curl -s -X POST "$API/api/lobechat/tool-gateway" \
  -H "x-dev-user: cust1" -H "content-type: application/json" \
  -d '{"name":"kb__search","arguments":{"query":"ping"}}')
if echo "$ok_body" | grep -q '"data"'; then check "T11 tool-gateway cust1 kb.search ok" 1 ""
else check "T11 tool-gateway cust1 kb.search ok" 0 "$ok_body"; fi

deny_code=$(curl -s -o /tmp/t11b.json -w "%{http_code}" -X POST "$API/api/lobechat/tool-gateway" \
  -H "x-dev-user: cust1" -H "content-type: application/json" \
  -d '{"name":"xiaoshou__search_customers","arguments":{}}')
if [ "$deny_code" = "403" ]; then check "T11b tool-gateway cust1 xiaoshou denied" 1 ""
else check "T11b tool-gateway cust1 xiaoshou denied" 0 "status=$deny_code body=$(cat /tmp/t11b.json)"; fi

# --- Test 12: bulk-import identity_map (super_admin) ---
import_body='{"entries":[
  {"source_system":"synthetic","entity_type":"widget","source_entity_id":"W-001","customer_id":"CUST-SYN-1"},
  {"source_system":"synthetic","entity_type":"widget","source_entity_id":"W-002","customer_id":"CUST-SYN-2"}
]}'
r1=$(curl -s -X POST "$API/api/admin/identity-map/import" \
  -H "x-dev-user: sa" -H "content-type: application/json" -d "$import_body")
ins=$(echo "$r1" | python3 -c "import json,sys;print(json.load(sys.stdin).get('inserted',0))" 2>/dev/null || echo 0)
upd=$(echo "$r1" | python3 -c "import json,sys;print(json.load(sys.stdin).get('updated',0))" 2>/dev/null || echo 0)
if [ "$ins" = "2" ] && [ "$upd" = "0" ]; then check "T12 bulk-import inserts 2" 1 ""
else check "T12 bulk-import inserts 2" 0 "resp=$r1"; fi

r2=$(curl -s -X POST "$API/api/admin/identity-map/import" \
  -H "x-dev-user: sa" -H "content-type: application/json" -d "$import_body")
ins2=$(echo "$r2" | python3 -c "import json,sys;print(json.load(sys.stdin).get('inserted',0))" 2>/dev/null || echo 0)
upd2=$(echo "$r2" | python3 -c "import json,sys;print(json.load(sys.stdin).get('updated',0))" 2>/dev/null || echo 0)
if [ "$ins2" = "0" ] && [ "$upd2" = "2" ]; then check "T12a bulk-import re-run updates 2" 1 ""
else check "T12a bulk-import re-run updates 2" 0 "resp=$r2"; fi

# --- Test 13: after bulk-import, previously-orphan T-900 is now visible to ops1 ---
fix_body='{"entries":[{"source_system":"gongdan","entity_type":"ticket","source_entity_id":"T-900","customer_id":"CUST-XXXX","owner_user_id":"USR-UNKNOWN","region":"CN-EAST"}]}'
curl -s -X POST "$API/api/admin/identity-map/import" \
  -H "x-dev-user: sa" -H "content-type: application/json" -d "$fix_body" >/dev/null
body=$(curl -s -X POST "$API/api/tools/call" \
  -H "x-dev-user: ops1" -H "content-type: application/json" \
  -d '{"tool":"gongdan.search_tickets","params":{}}')
has_t900=$(echo "$body" | grep -c '"id":"T-900"' || true)
if [ "$has_t900" -ge "1" ]; then check "T13 ops1 now sees T-900 after import" 1 ""
else check "T13 ops1 now sees T-900 after import" 0 "body=$body"; fi

# --- Test 13b: permission_admin cannot call discover (403) ---
resp=$(curl -s -o /tmp/t13b.json -w "%{http_code}" -X POST "$API/api/admin/identity-map/discover" \
  -H "x-dev-user: pa" -H "content-type: application/json" \
  -d '{"source_system":"gongdan","entity_type":"ticket"}')
if [ "$resp" = "403" ]; then check "T13b permission_admin deny discover" 1 ""
else check "T13b permission_admin deny discover" 0 "status=$resp body=$(cat /tmp/t13b.json)"; fi

# --- Test 14: cache invalidation on tool-permission toggle ---
# 1) Confirm sales1 currently has xiaoshou.search_customers allowed (baseline from seed)
base=$(curl -s -H "x-dev-user: sales1" "$API/api/capabilities")
base_has=$(echo "$base" | grep -c '"xiaoshou.search_customers"' || true)
if [ "$base_has" -ge "1" ]; then check "T14 sales1 baseline has xiaoshou.search_customers" 1 ""
else check "T14 sales1 baseline has xiaoshou.search_customers" 0 "base=$base"; fi

# 2) Look up sales1 user-id and xiaoshou.search_customers tool-id via admin API
sales1_id=$(curl -s -H "x-dev-user: sa" "$API/api/admin/users" | python3 -c "import json,sys;[print(u['id']) for u in json.load(sys.stdin) if u['username']=='sales1']")
tool_id=$(curl -s -H "x-dev-user: sa" "$API/api/admin/tools" | python3 -c "import json,sys;[print(t['id']) for t in json.load(sys.stdin) if t['key']=='xiaoshou.search_customers']")

# 3) Admin writes an explicit DENY for sales1 on that tool
deny_resp=$(curl -s -X POST "$API/api/admin/tool-permissions" \
  -H "x-dev-user: sa" -H "content-type: application/json" \
  -d "{\"subject_type\":\"user\",\"subject_id\":\"$sales1_id\",\"tool_id\":\"$tool_id\",\"allow\":false}")
deny_id=$(echo "$deny_resp" | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))" 2>/dev/null)

# 4) Immediately re-query capabilities for sales1 — cache MUST have been invalidated
after=$(curl -s -H "x-dev-user: sales1" "$API/api/capabilities")
after_has=$(echo "$after" | grep -c '"xiaoshou.search_customers"' || true)
if [ "$after_has" = "0" ]; then check "T14a cache invalidated: deny visible immediately" 1 ""
else check "T14a cache invalidated: deny visible immediately" 0 "after=$after"; fi

# 5) Cleanup: remove the deny so re-running acceptance stays idempotent
if [ -n "$deny_id" ]; then
  curl -s -X DELETE "$API/api/admin/tool-permissions/$deny_id" -H "x-dev-user: sa" >/dev/null
fi

# 6) Timing sanity: second GET within TTL should be fast (<50ms typical; allow 200ms on slow CI)
t1=$(curl -s -o /dev/null -w "%{time_total}" -H "x-dev-user: sales1" "$API/api/capabilities")
t2=$(curl -s -o /dev/null -w "%{time_total}" -H "x-dev-user: sales1" "$API/api/capabilities")
fast=$(python3 -c "print(1 if float('$t2') < 0.200 else 0)")
if [ "$fast" = "1" ]; then check "T14b cached GET /api/capabilities under 200ms (t1=${t1}s t2=${t2}s)" 1 ""
else check "T14b cached GET /api/capabilities under 200ms (t1=${t1}s t2=${t2}s)" 0 "t2=$t2"; fi

# T15 admin UI
code=$(curl -s -o /dev/null -w "%{http_code}" -H "x-dev-user: sa" "$API/admin")
[ "$code" = "200" ] && check "T15 sa can GET /admin (200)" 1 "" || check "T15 sa can GET /admin" 0 "got $code"

code=$(curl -s -o /dev/null -w "%{http_code}" -H "x-dev-user: cust1" "$API/admin")
[ "$code" = "403" ] && check "T15b cust1 denied /admin (403)" 1 "" || check "T15b cust1 denied /admin" 0 "got $code"

code=$(curl -s -o /dev/null -w "%{http_code}" -H "x-dev-user: pa" "$API/admin/audit")
[ "$code" = "200" ] && check "T15c pa can GET /admin/audit (200)" 1 "" || check "T15c pa /admin/audit" 0 "got $code"

# --- Test 16: async audit via BullMQ — a tool call lands in audit within 2s ---
marker="t16-$(date +%s%N)"
t_start=$(python3 -c "import time;print(time.time())")
# Use a denied call so it always writes an audit row regardless of upstream state.
curl -s -o /dev/null -X POST "$API/api/tools/call" \
  -H "x-dev-user: cust1" -H "content-type: application/json" \
  -d "{\"tool\":\"xiaoshou.search_customers\",\"params\":{\"_marker\":\"$marker\"}}"
t_end=$(python3 -c "import time;print(time.time())")
latency_ms=$(python3 -c "print(int(($t_end - $t_start)*1000))")

found=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  # Poll audit up to ~2s (10 * 200ms)
  rows=$(curl -s "$API/api/admin/audit?user=cust1&tool=xiaoshou.search_customers&outcome=denied" -H "x-dev-user: sa")
  if echo "$rows" | grep -q "$marker"; then found=1; break; fi
  python3 -c "import time;time.sleep(0.2)"
done
if [ "$found" = "1" ]; then check "T16 async audit row appears within 2s (latency=${latency_ms}ms)" 1 ""
else check "T16 async audit row appears within 2s (latency=${latency_ms}ms)" 0 "marker=$marker not found"; fi

# T16b: response-latency soft-check — ensure /api/tools/call returned in under 1500ms.
# Not a hard guarantee of speedup vs sync baseline; just proves async path isn't catastrophically slower.
if [ "$latency_ms" -lt "1500" ]; then check "T16b /api/tools/call latency under 1500ms (${latency_ms}ms)" 1 ""
else check "T16b /api/tools/call latency under 1500ms (${latency_ms}ms)" 0 "latency=${latency_ms}ms"; fi

# --- Test 17: rate limiting — 65 rapid kb.search calls as cust1 -> last returns 429 ---
# Rate limit on /api/lobechat/tool-gateway is 60/min. Send 65 calls; at least one must 429.
t17_429=0
for i in $(seq 1 65); do
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/lobechat/tool-gateway" \
    -H "x-dev-user: cust1" -H "content-type: application/json" \
    -d '{"name":"kb__search","arguments":{"query":"t17-burst"}}')
  if [ "$code" = "429" ]; then t17_429=1; break; fi
done
if [ "$t17_429" = "1" ]; then check "T17 rate-limit: 65 rapid kb.search as cust1 hits 429" 1 ""
else check "T17 rate-limit: 65 rapid kb.search as cust1 hits 429" 0 "no 429 received after 65 calls"; fi

# --- Test 18: POST /admin/login without csrf → not-200 (403) ---
resp=$(curl -s -o /tmp/t18.json -w "%{http_code}" -X POST "$API/admin/login" \
  -H "content-type: application/x-www-form-urlencoded" \
  -d "username=sa")
if [ "$resp" != "200" ] && [ "$resp" != "302" ]; then check "T18 POST /admin/login no-csrf -> not-200 (got $resp)" 1 ""
else check "T18 POST /admin/login no-csrf -> not-200" 0 "got $resp body=$(cat /tmp/t18.json)"; fi

# --- Test 18b: GET /admin/login, extract csrf, POST with it → 200 or 302 and dev_user cookie set ---
# Use single cookie jar (-b/-c same file) so admin_csrf cookie is sent back on POST
rm -f /tmp/t18b_jar.txt
login_html=$(curl -s -b /tmp/t18b_jar.txt -c /tmp/t18b_jar.txt "$API/admin/login")
csrf_token=$(echo "$login_html" | grep -oE 'name="_csrf" value="[^"]+"' | sed 's/.*value="\([^"]*\)"/\1/')
if [ -z "$csrf_token" ]; then
  check "T18b admin login csrf flow" 0 "could not extract csrf token from login page"
else
  resp=$(curl -s -o /tmp/t18b_out.txt -w "%{http_code}" -b /tmp/t18b_jar.txt -c /tmp/t18b_jar.txt \
    -X POST "$API/admin/login" \
    -H "content-type: application/x-www-form-urlencoded" \
    --data-urlencode "username=sa" \
    --data-urlencode "_csrf=$csrf_token")
  has_cookie=$(grep -c "dev_user" /tmp/t18b_jar.txt 2>/dev/null || echo 0)
  if ([ "$resp" = "200" ] || [ "$resp" = "302" ]) && [ "$has_cookie" -ge "1" ]; then
    check "T18b admin login with csrf -> 200/302 + dev_user cookie set" 1 ""
  else
    check "T18b admin login with csrf -> 200/302 + dev_user cookie set" 0 "resp=$resp has_cookie=$has_cookie body=$(cat /tmp/t18b_out.txt)"
  fi
fi

# --- Test 19: GET /metrics anon → 401 ---
resp=$(curl -s -o /tmp/t19.json -w "%{http_code}" "$API/metrics")
if [ "$resp" = "401" ]; then check "T19 /metrics anon -> 401" 1 ""
else check "T19 /metrics anon -> 401" 0 "got $resp body=$(cat /tmp/t19.json)"; fi

# --- Test 19a: GET /metrics with x-dev-user: sa → 200 and body contains gateway_tool_call_total ---
resp=$(curl -s -o /tmp/t19a.json -w "%{http_code}" "$API/metrics" -H "x-dev-user: sa")
has_metric=$(grep -c "gateway_tool_call_total" /tmp/t19a.json 2>/dev/null || echo 0)
if [ "$resp" = "200" ] && [ "$has_metric" -ge "1" ]; then check "T19a /metrics as sa -> 200 + gateway_tool_call_total" 1 ""
else check "T19a /metrics as sa -> 200 + gateway_tool_call_total" 0 "resp=$resp has_metric=$has_metric"; fi

# --- Test 19b: GET /metrics with Authorization: Bearer METRICS_TOKEN → 200 ---
METRICS_TOKEN="${METRICS_TOKEN:-devmetrics}"
resp=$(curl -s -o /tmp/t19b.json -w "%{http_code}" "$API/metrics" -H "Authorization: Bearer $METRICS_TOKEN")
if [ "$resp" = "200" ]; then check "T19b /metrics with Bearer token -> 200" 1 ""
else check "T19b /metrics with Bearer token -> 200" 0 "got $resp body=$(cat /tmp/t19b.json)"; fi

# --- Test 20: fire two tool calls, scrape /metrics, counter for that tool should be >=2 ---
# Use xiaoshou.search_customers via sa (who has super_admin access to all tools)
for i in 1 2; do
  curl -s -o /dev/null -X POST "$API/api/tools/call" \
    -H "x-dev-user: sa" -H "content-type: application/json" \
    -d '{"tool":"xiaoshou.search_customers","params":{}}'
done
metrics_body=$(curl -s "$API/metrics" -H "x-dev-user: sa")
# Look for gateway_tool_call_total with tool="xiaoshou.search_customers" and any outcome with value >=2
# prom format: gateway_tool_call_total{outcome="ok",tool="xiaoshou.search_customers"} 2
t20_count=$(echo "$metrics_body" | grep -E 'gateway_tool_call_total\{[^}]*tool="xiaoshou\.search_customers"' | grep -oE '[0-9]+$' | awk '{s+=$1} END{print s+0}')
if [ "${t20_count:-0}" -ge "2" ]; then check "T20 tool call counter >=2 for xiaoshou.search_customers (got $t20_count)" 1 ""
else check "T20 tool call counter >=2 for xiaoshou.search_customers" 0 "count=${t20_count} metrics=$(echo "$metrics_body" | grep gateway_tool_call_total | head -5)"; fi

# --- Test 22a: super_admin creates a test role ---
role_key="t22-role-$(date +%s%N)"
create_resp=$(curl -s -o /tmp/t22a.json -w "%{http_code}" -X POST "$API/api/admin/roles" \
  -H "x-dev-user: sa" -H "content-type: application/json" \
  -d "{\"key\":\"$role_key\",\"name\":\"T22 Test Role\",\"description\":\"initial\"}")
role_id=$(python3 -c "import json;d=json.load(open('/tmp/t22a.json'));print(d.get('id',''))" 2>/dev/null)
if [ "$create_resp" = "201" ] && [ -n "$role_id" ]; then check "T22a super_admin creates role" 1 ""
else check "T22a super_admin creates role" 0 "status=$create_resp body=$(cat /tmp/t22a.json)"; fi

# --- Test 22b: update role description via PUT ---
upd_resp=$(curl -s -o /tmp/t22b.json -w "%{http_code}" -X PUT "$API/api/admin/roles/$role_id" \
  -H "x-dev-user: sa" -H "content-type: application/json" \
  -d '{"description":"updated desc"}')
upd_desc=$(python3 -c "import json;d=json.load(open('/tmp/t22b.json'));print(d.get('description',''))" 2>/dev/null)
if [ "$upd_resp" = "200" ] && [ "$upd_desc" = "updated desc" ]; then check "T22b update role description" 1 ""
else check "T22b update role description" 0 "status=$upd_resp body=$(cat /tmp/t22b.json)"; fi

# --- Test 22c: delete succeeds (no references) then fails 409 when referenced ---
del_resp=$(curl -s -o /tmp/t22c.json -w "%{http_code}" -X DELETE "$API/api/admin/roles/$role_id" \
  -H "x-dev-user: sa")
if [ "$del_resp" = "200" ]; then check "T22c delete role (no refs) succeeds" 1 ""
else check "T22c delete role (no refs) succeeds" 0 "status=$del_resp body=$(cat /tmp/t22c.json)"; fi

# Now try to delete super_admin role (referenced by many users + permissions) -> expect 409
sa_role_id=$(curl -s -H "x-dev-user: sa" "$API/api/admin/roles" | python3 -c "import json,sys;[print(r['id']) for r in json.load(sys.stdin) if r['key']=='super_admin']")
del409=$(curl -s -o /tmp/t22c2.json -w "%{http_code}" -X DELETE "$API/api/admin/roles/$sa_role_id" \
  -H "x-dev-user: sa")
if [ "$del409" = "409" ]; then check "T22c2 delete referenced role returns 409" 1 ""
else check "T22c2 delete referenced role returns 409" 0 "status=$del409 body=$(cat /tmp/t22c2.json)"; fi

# --- Test 22d: scope DSL validator ---
bad_scope='{"subject_type":"user","subject_id":"'$sales1_id'","source_system":"xiaoshou","entity_type":"customer","scope":{"unknown_field":"x"}}'
bad_resp=$(curl -s -o /tmp/t22d_bad.json -w "%{http_code}" -X POST "$API/api/admin/data-scopes" \
  -H "x-dev-user: sa" -H "content-type: application/json" -d "$bad_scope")
if [ "$bad_resp" = "400" ]; then check "T22d bad scope field -> 400" 1 ""
else check "T22d bad scope field -> 400" 0 "status=$bad_resp body=$(cat /tmp/t22d_bad.json)"; fi

good_scope='{"subject_type":"user","subject_id":"'$sales1_id'","source_system":"xiaoshou","entity_type":"customer","scope":{"region":{"$in":["CN-EAST","CN-NORTH"]}}}'
good_resp=$(curl -s -o /tmp/t22d_good.json -w "%{http_code}" -X POST "$API/api/admin/data-scopes" \
  -H "x-dev-user: sa" -H "content-type: application/json" -d "$good_scope")
new_scope_id=$(python3 -c "import json;d=json.load(open('/tmp/t22d_good.json'));print(d.get('id',''))" 2>/dev/null)
if [ "$good_resp" = "201" ] && [ -n "$new_scope_id" ]; then check "T22d well-formed \$in scope -> 201" 1 ""
else check "T22d well-formed \$in scope -> 201" 0 "status=$good_resp body=$(cat /tmp/t22d_good.json)"; fi
# Cleanup
if [ -n "$new_scope_id" ]; then
  curl -s -X DELETE "$API/api/admin/data-scopes/$new_scope_id" -H "x-dev-user: sa" >/dev/null
fi

# --- Test 22e: GET /api/admin/tools/:key/schema returns real JSON schema ---
schema_body=$(curl -s -H "x-dev-user: sa" "$API/api/admin/tools/kb.search/schema")
has_type=$(echo "$schema_body" | python3 -c "import json,sys;d=json.load(sys.stdin);print(1 if d.get('input_schema',{}).get('type')=='object' and 'query' in d.get('input_schema',{}).get('properties',{}) else 0)" 2>/dev/null || echo 0)
if [ "$has_type" = "1" ]; then check "T22e GET kb.search schema has type:object + properties.query" 1 ""
else check "T22e GET kb.search schema has type:object + properties.query" 0 "body=$schema_body"; fi

# --- Test 23c: customer create_ticket with minimal params fills defaults (mock path) ---
body=$(curl -s -X POST "$API/api/tools/call" \
  -H "x-dev-user: cust1" -H "content-type: application/json" \
  -d '{"tool":"gongdan.create_ticket","params":{"description":"test"}}')
has_customer=$(echo "$body" | grep -cE '"customer[iI]d":"CUST-0001"' || true)
if [ "$has_customer" -ge "1" ]; then check "T23c customer create_ticket defaults + customerId=CUST-0001" 1 ""
else check "T23c customer create_ticket defaults + customerId=CUST-0001" 0 "body=$body"; fi

# --- Test 24: xiaoshou adapter registered + denies customer (no upstream key required) ---
resp=$(curl -s -o /tmp/t24.json -w "%{http_code}" -X POST "$API/api/tools/call" \
  -H "x-dev-user: cust1" -H "content-type: application/json" \
  -d '{"tool":"xiaoshou.get_customer","params":{"id":"CUST-0001"}}')
if [ "$resp" = "403" ]; then check "T24 xiaoshou adapter registered and denies customer" 1 ""
else check "T24 xiaoshou adapter registered and denies customer" 0 "status=$resp body=$(cat /tmp/t24.json)"; fi

echo
echo "=========================================="
echo "Summary: pass=$pass fail=$fail"
echo "=========================================="
for r in "${results[@]}"; do echo "  $r"; done
[ "$fail" = "0" ]
