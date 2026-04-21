#!/usr/bin/env bash
# pilot-all.sh — run every pilot-*.sh sequentially and print a summary table.
# Pilots are detected dynamically; set PILOT_SKIP=name1,name2 to skip by name.
# Exit 0 if every pilot exited 0 (SKIPPED counts as pass).
# Compatible with bash 3.x (macOS default).
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Collect pilot scripts (sorted), excluding this orchestrator.
PILOT_LIST="$(ls "$SCRIPT_DIR"/pilot-*.sh 2>/dev/null | grep -v 'pilot-all\.sh' | sort)"

if [ -z "$PILOT_LIST" ]; then
  echo "[pilot-all] no pilot-*.sh scripts found in $SCRIPT_DIR"
  exit 0
fi

# Parse PILOT_SKIP=name1,name2 — stored as colon-separated for sh compat.
SKIP_PATTERN=""
if [ -n "${PILOT_SKIP:-}" ]; then
  SKIP_PATTERN=":$(echo "$PILOT_SKIP" | tr ',' ':'):"
fi

is_skipped() {
  local name="$1"
  [ -n "$SKIP_PATTERN" ] && echo "$SKIP_PATTERN" | grep -q ":${name}:"
}

# --- Parallel arrays using indexed variable names (bash 3 compat) ---
ROW_COUNT=0
overall_exit=0
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

while IFS= read -r script; do
  [ -z "$script" ] && continue
  pilot_file="$(basename "$script" .sh)"   # pilot-gongdan
  pilot_name="${pilot_file#pilot-}"        # gongdan

  idx=$ROW_COUNT
  ROW_COUNT=$((ROW_COUNT + 1))
  eval "ROW_NAME_${idx}='${pilot_name}'"

  if is_skipped "$pilot_name"; then
    eval "ROW_HTTP_${idx}='-'"
    eval "ROW_EXIT_${idx}='SKIPPED'"
    eval "ROW_NOTE_${idx}='skipped via PILOT_SKIP'"
    continue
  fi

  log="$tmpdir/${pilot_name}.log"
  echo "[pilot-all] running $pilot_name ..."
  bash "$script" >"$log" 2>&1
  ec=$?

  # Extract last http=NNN from log.
  http_val="$(grep -oE 'http=[0-9]+' "$log" | tail -1 | cut -d= -f2)"
  [ -z "$http_val" ] && http_val="-"

  # Extract a short note.
  note=""
  if grep -q 'SKIPPED\|skipped\|SKIP' "$log"; then
    note="$(grep -m1 'SKIPPED\|skipped\|SKIP' "$log" | cut -c1-80)"
  elif grep -q 'CONDITIONAL PASS' "$log"; then
    note="$(grep -m1 'CONDITIONAL PASS' "$log" | sed 's/\[pilot[^]]*\] //' | cut -c1-80)"
  elif grep -q 'FAIL' "$log"; then
    note="$(grep -m1 'FAIL' "$log" | sed 's/\[pilot[^]]*\] //' | cut -c1-80)"
  elif grep -qE 'OK|PASS' "$log"; then
    note="$(grep -m1 -E 'OK|PASS' "$log" | sed 's/\[pilot[^]]*\] //' | cut -c1-80)"
  fi

  eval "ROW_HTTP_${idx}='${http_val}'"
  eval "ROW_EXIT_${idx}='${ec}'"
  # Strip single quotes from note to avoid eval issues.
  note_safe="$(echo "$note" | tr "'" ' ')"
  eval "ROW_NOTE_${idx}='${note_safe}'"

  if [ "$ec" -ne 0 ]; then
    overall_exit=1
    echo "[pilot-all] $pilot_name FAILED (exit $ec)"
    tail -20 "$log"
  else
    echo "[pilot-all] $pilot_name OK (exit 0)"
  fi
done <<EOF
$PILOT_LIST
EOF

# --- Summary table ---
echo ""
echo "============================================================"
echo " pilot-all summary"
echo "============================================================"
printf "%-20s  %-6s  %-8s  %s\n" "pilot" "http" "exit" "note"
printf "%-20s  %-6s  %-8s  %s\n" "--------------------" "------" "--------" "----"

i=0
while [ "$i" -lt "$ROW_COUNT" ]; do
  eval "n=\$ROW_NAME_${i}"
  eval "h=\$ROW_HTTP_${i}"
  eval "e=\$ROW_EXIT_${i}"
  eval "t=\$ROW_NOTE_${i}"
  printf "%-20s  %-6s  %-8s  %s\n" "$n" "$h" "$e" "$t"
  i=$((i + 1))
done

echo "============================================================"

if [ "$overall_exit" -eq 0 ]; then
  echo "[pilot-all] all pilots passed (or skipped)"
else
  echo "[pilot-all] one or more pilots FAILED"
fi
exit "$overall_exit"
