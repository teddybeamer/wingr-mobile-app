#!/usr/bin/env bash
set -euo pipefail

readonly DB_CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_wingr-mobile-app}"
readonly SAME_USER="00000000-0000-4000-8000-000000000501"
readonly NEAR_LIMIT_USER="00000000-0000-4000-8000-000000000502"
readonly AT_LIMIT_USER="00000000-0000-4000-8000-000000000503"
readonly USER_A="00000000-0000-4000-8000-000000000504"
readonly USER_B="00000000-0000-4000-8000-000000000505"
readonly OUTPUT_DIR="$(mktemp -d /tmp/wingr-db-concurrency.XXXXXX)"

run_sql() {
  docker exec -i "$DB_CONTAINER" psql \
    -XqAt \
    -v ON_ERROR_STOP=1 \
    -U postgres \
    -d postgres \
    -c "$1"
}

cleanup_database() {
  run_sql "
    set session_replication_role = replica;
    delete from public.ai_generation_leases
    where user_id in ('$SAME_USER', '$NEAR_LIMIT_USER', '$AT_LIMIT_USER', '$USER_A', '$USER_B');
    delete from public.onboarding_ai_reply_claims
    where user_id in ('$SAME_USER', '$NEAR_LIMIT_USER', '$AT_LIMIT_USER', '$USER_A', '$USER_B');
    delete from public.ai_generation_attempts
    where user_id in ('$SAME_USER', '$NEAR_LIMIT_USER', '$AT_LIMIT_USER', '$USER_A', '$USER_B');
  " >/dev/null
}
trap cleanup_database EXIT

claim() {
  local user_id="$1"
  run_sql "
    set session_replication_role = replica;
    select set_config('request.jwt.claim.sub', '$user_id', false) is not null;
    select public.begin_ai_generation()->>'status';
  " | awk '$0 != "t"'
}

count_status() {
  local status="$1"
  shift
  awk -v expected="$status" '$0 == expected { count++ } END { print count + 0 }' "$@"
}

assert_equal() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  if [[ "$expected" != "$actual" ]]; then
    echo "FAIL: $message (expected $expected, got $actual)" >&2
    exit 1
  fi
}

run_parallel_claims() {
  local prefix="$1"
  local user_id="$2"
  local count="$3"
  local pids=()
  for index in $(seq 1 "$count"); do
    claim "$user_id" >"$OUTPUT_DIR/$prefix-$index" &
    pids+=("$!")
  done
  for pid in "${pids[@]}"; do
    wait "$pid"
  done
}

cleanup_database

run_parallel_claims same "$SAME_USER" 50
assert_equal 1 "$(count_status allowed "$OUTPUT_DIR"/same-*)" "one of 50 same-user claims is allowed"
assert_equal 49 "$(count_status generation_in_progress "$OUTPUT_DIR"/same-*)" "the other 49 same-user claims are rejected"
assert_equal 1 "$(run_sql "select count(*) from public.ai_generation_attempts where user_id = '$SAME_USER'")" "same-user burst inserts one attempt"

run_sql "
  set session_replication_role = replica;
  insert into public.ai_generation_attempts (user_id, attempted_at)
  select '$NEAR_LIMIT_USER', now() - interval '1 day' from generate_series(1, 499);
" >/dev/null
run_parallel_claims near-limit "$NEAR_LIMIT_USER" 20
assert_equal 1 "$(count_status allowed "$OUTPUT_DIR"/near-limit-*)" "one near-limit claim becomes attempt 500"
assert_equal 19 "$(count_status generation_in_progress "$OUTPUT_DIR"/near-limit-*)" "concurrent near-limit claims see the active lease"
assert_equal 500 "$(run_sql "select count(*) from public.ai_generation_attempts where user_id = '$NEAR_LIMIT_USER'")" "near-limit burst stops at 500 attempts"

run_sql "
  set session_replication_role = replica;
  insert into public.ai_generation_attempts (user_id, attempted_at)
  select '$AT_LIMIT_USER', now() - interval '1 day' from generate_series(1, 500);
" >/dev/null
run_parallel_claims at-limit "$AT_LIMIT_USER" 10
assert_equal 10 "$(count_status usage_limit "$OUTPUT_DIR"/at-limit-*)" "all claims at 500 are usage-limited"
assert_equal 0 "$(run_sql "select count(*) from public.ai_generation_leases where user_id = '$AT_LIMIT_USER'")" "a usage-limited burst creates no lease"

pids=()
for index in $(seq 1 10); do
  claim "$USER_A" >"$OUTPUT_DIR/user-a-$index" &
  pids+=("$!")
  claim "$USER_B" >"$OUTPUT_DIR/user-b-$index" &
  pids+=("$!")
done
for pid in "${pids[@]}"; do
  wait "$pid"
done
assert_equal 1 "$(count_status allowed "$OUTPUT_DIR"/user-a-*)" "user A has one active generation"
assert_equal 1 "$(count_status allowed "$OUTPUT_DIR"/user-b-*)" "user B has one active generation"
assert_equal 2 "$(run_sql "select count(*) from public.ai_generation_attempts where user_id in ('$USER_A', '$USER_B')")" "separate users each insert one attempt"

echo "Separate-session AI generation concurrency checks passed."
