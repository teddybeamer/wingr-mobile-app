#!/usr/bin/env bash
set -euo pipefail

readonly DB_CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_wingr-mobile-app}"
readonly SAME_USER="00000000-0000-4000-8000-000000000501"
readonly NEAR_LIMIT_USER="00000000-0000-4000-8000-000000000502"
readonly AT_LIMIT_USER="00000000-0000-4000-8000-000000000503"
readonly USER_A="00000000-0000-4000-8000-000000000504"
readonly USER_B="00000000-0000-4000-8000-000000000505"
readonly WEEKLY_NEAR_LIMIT_USER="00000000-0000-4000-8000-000000000506"
readonly WEEKLY_AT_LIMIT_USER="00000000-0000-4000-8000-000000000507"
readonly SETTLE_BURST_USER="00000000-0000-4000-8000-000000000508"
readonly SETTLE_RACE_USER="00000000-0000-4000-8000-000000000509"
readonly SETTLE_INVALID_USER="00000000-0000-4000-8000-000000000510"
readonly SETTLE_LIMIT_USER="00000000-0000-4000-8000-000000000511"
readonly SETTLE_SESSIONS_USER="00000000-0000-4000-8000-000000000512"
readonly SETTLE_USER_A="00000000-0000-4000-8000-000000000513"
readonly SETTLE_USER_B="00000000-0000-4000-8000-000000000514"
readonly TRIAL_BEGIN_USER="00000000-0000-4000-8000-000000000515"
readonly TRIAL_FINALIZE_USER="00000000-0000-4000-8000-000000000516"
readonly TRIAL_TWO_TRIALS_USER="00000000-0000-4000-8000-000000000517"
readonly ALL_USERS="'$SAME_USER', '$NEAR_LIMIT_USER', '$AT_LIMIT_USER', '$USER_A', '$USER_B', '$WEEKLY_NEAR_LIMIT_USER', '$WEEKLY_AT_LIMIT_USER', '$SETTLE_BURST_USER', '$SETTLE_RACE_USER', '$SETTLE_INVALID_USER', '$SETTLE_LIMIT_USER', '$SETTLE_SESSIONS_USER', '$SETTLE_USER_A', '$SETTLE_USER_B', '$TRIAL_BEGIN_USER', '$TRIAL_FINALIZE_USER', '$TRIAL_TWO_TRIALS_USER'"
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
    where user_id in ($ALL_USERS);
    delete from public.onboarding_ai_reply_claims
    where user_id in ($ALL_USERS);
    delete from public.ai_generation_attempts
    where user_id in ($ALL_USERS);
    delete from public.ai_invalid_screenshot_counters
    where user_id in ($ALL_USERS);
    delete from public.onboarding_device_trials
    where user_id in ($ALL_USERS);
  " >/dev/null
}
trap cleanup_database EXIT

claim() {
  local user_id="$1"
  local plan="${2:-}"
  local claim_sql="select public.begin_ai_generation()->>'status';"
  if [[ -n "$plan" ]]; then
    claim_sql="select public.begin_ai_generation(false, '$plan')->>'status';"
  fi
  run_sql "
    set session_replication_role = replica;
    select set_config('request.jwt.claim.sub', '$user_id', false) is not null;
    $claim_sql
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
  local plan="${4:-}"
  local pids=()
  for index in $(seq 1 "$count"); do
    claim "$user_id" "$plan" >"$OUTPUT_DIR/$prefix-$index" &
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

run_sql "
  set session_replication_role = replica;
  insert into public.ai_generation_attempts (user_id, attempted_at)
  select '$WEEKLY_NEAR_LIMIT_USER', now() - interval '1 day' from generate_series(1, 124);
" >/dev/null
run_parallel_claims weekly-near-limit "$WEEKLY_NEAR_LIMIT_USER" 20 weekly
assert_equal 1 "$(count_status allowed "$OUTPUT_DIR"/weekly-near-limit-*)" "one near-limit Weekly claim becomes attempt 125"
assert_equal 19 "$(count_status generation_in_progress "$OUTPUT_DIR"/weekly-near-limit-*)" "concurrent near-limit Weekly claims see the active lease"
assert_equal 125 "$(run_sql "select count(*) from public.ai_generation_attempts where user_id = '$WEEKLY_NEAR_LIMIT_USER'")" "near-limit Weekly burst stops at 125 attempts"

run_sql "
  set session_replication_role = replica;
  insert into public.ai_generation_attempts (user_id, attempted_at)
  select '$WEEKLY_AT_LIMIT_USER', now() - interval '1 day' from generate_series(1, 125);
" >/dev/null
run_parallel_claims weekly-at-limit "$WEEKLY_AT_LIMIT_USER" 10 weekly
assert_equal 10 "$(count_status usage_limit "$OUTPUT_DIR"/weekly-at-limit-*)" "all Weekly claims at 125 are usage-limited"
assert_equal 0 "$(run_sql "select count(*) from public.ai_generation_leases where user_id = '$WEEKLY_AT_LIMIT_USER'")" "a usage-limited Weekly burst creates no lease"

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


# ---------------------------------------------------------------------------
# Reserve / settle: charge at the end, once, with no double charging.
# Every psql call below is a separate database session, so these also prove the
# counters persist between sessions.
# ---------------------------------------------------------------------------
reserve() {
  local user_id="$1"
  local plan="${2:-monthly}"
  run_sql "
    set session_replication_role = replica;
    select set_config('request.jwt.claim.sub', '$user_id', false) is not null;
    select concat_ws('|', r->>'status', r->>'leaseId')
    from (select public.reserve_ai_generation('$plan') as r) as reserved;
  " | awk '$0 != "t"'
}

settle() {
  local user_id="$1"
  local lease_id="$2"
  local outcome="$3"
  run_sql "
    set session_replication_role = replica;
    select set_config('request.jwt.claim.sub', '$user_id', false) is not null;
    select public.settle_ai_generation('$lease_id', '$outcome')->>'status';
  " | awk '$0 != "t"'
}

attempts_of() {
  run_sql "select count(*) from public.ai_generation_attempts where user_id = '$1'"
}

run_parallel_reserves() {
  local prefix="$1"
  local user_id="$2"
  local count="$3"
  local pids=()
  for index in $(seq 1 "$count"); do
    reserve "$user_id" >"$OUTPUT_DIR/$prefix-$index" &
    pids+=("$!")
  done
  for pid in "${pids[@]}"; do
    wait "$pid"
  done
}

run_parallel_settles() {
  local prefix="$1"
  local user_id="$2"
  local lease_id="$3"
  local outcome="$4"
  local count="$5"
  local pids=()
  for index in $(seq 1 "$count"); do
    settle "$user_id" "$lease_id" "$outcome" >"$OUTPUT_DIR/$prefix-$index" &
    pids+=("$!")
  done
  for pid in "${pids[@]}"; do
    wait "$pid"
  done
}

count_prefix() {
  local prefix="$1"
  shift
  awk -F'|' -v expected="$prefix" '$1 == expected { count++ } END { print count + 0 }' "$@"
}

run_parallel_reserves reserve-burst "$SETTLE_BURST_USER" 50
assert_equal 1 "$(count_prefix allowed "$OUTPUT_DIR"/reserve-burst-*)" "one of 50 same-user reservations is allowed"
assert_equal 49 "$(count_prefix generation_in_progress "$OUTPUT_DIR"/reserve-burst-*)" "the other 49 reservations see the active lease"
assert_equal 0 "$(attempts_of "$SETTLE_BURST_USER")" "a reservation burst charges nothing"

SETTLE_LEASE="$(reserve "$SETTLE_RACE_USER" | cut -d'|' -f2)"
run_parallel_settles settle-race "$SETTLE_RACE_USER" "$SETTLE_LEASE" success 30
assert_equal 1 "$(count_status settled "$OUTPUT_DIR"/settle-race-*)" "exactly one of 30 parallel settlements of a lease applies"
assert_equal 29 "$(count_status not_found "$OUTPUT_DIR"/settle-race-*)" "the other 29 settlements are no-ops"
assert_equal 1 "$(attempts_of "$SETTLE_RACE_USER")" "30 parallel successful settlements charge exactly one attempt"
assert_equal 0 "$(run_sql "select count(*) from public.ai_generation_leases where user_id = '$SETTLE_RACE_USER'")" "settling frees the lease"

INVALID_LEASE="$(reserve "$SETTLE_INVALID_USER" | cut -d'|' -f2)"
run_parallel_settles settle-invalid "$SETTLE_INVALID_USER" "$INVALID_LEASE" invalid_screenshot 30
assert_equal 1 "$(count_status settled "$OUTPUT_DIR"/settle-invalid-*)" "one of 30 parallel invalid-screenshot settlements applies"
assert_equal 1 "$(run_sql "select pending from public.ai_invalid_screenshot_counters where user_id = '$SETTLE_INVALID_USER'")" "30 parallel settlements of one lease count one invalid screenshot"
assert_equal 0 "$(attempts_of "$SETTLE_INVALID_USER")" "a counted invalid screenshot below five charges nothing"

run_sql "
  set session_replication_role = replica;
  insert into public.ai_generation_attempts (user_id, attempted_at)
  select '$SETTLE_LIMIT_USER', now() - interval '1 day' from generate_series(1, 499);
" >/dev/null
run_parallel_reserves settle-limit "$SETTLE_LIMIT_USER" 20
assert_equal 1 "$(count_prefix allowed "$OUTPUT_DIR"/settle-limit-*)" "one near-limit reservation is allowed"
LIMIT_LEASE="$(cat "$OUTPUT_DIR"/settle-limit-* | awk -F'|' '$1 == "allowed" { print $2 }')"
assert_equal 499 "$(attempts_of "$SETTLE_LIMIT_USER")" "a near-limit reservation has not charged yet"
settle "$SETTLE_LIMIT_USER" "$LIMIT_LEASE" success >/dev/null
assert_equal 500 "$(attempts_of "$SETTLE_LIMIT_USER")" "settling the near-limit generation records attempt 500"
run_parallel_reserves settle-limit-after "$SETTLE_LIMIT_USER" 10
assert_equal 10 "$(count_prefix usage_limit "$OUTPUT_DIR"/settle-limit-after-*)" "all reservations at 500 are usage-limited"
assert_equal 500 "$(attempts_of "$SETTLE_LIMIT_USER")" "a limited burst never pushes past 500"

for index in $(seq 1 10); do
  lease="$(reserve "$SETTLE_SESSIONS_USER" | cut -d'|' -f2)"
  settle "$SETTLE_SESSIONS_USER" "$lease" invalid_screenshot >/dev/null
done
assert_equal 2 "$(attempts_of "$SETTLE_SESSIONS_USER")" "10 invalid screenshots across 10 separate sessions cost exactly 2 attempts"
assert_equal 0 "$(run_sql "select pending from public.ai_invalid_screenshot_counters where user_id = '$SETTLE_SESSIONS_USER'")" "the persisted count restarts after each charge"

pids=()
for index in $(seq 1 10); do
  reserve "$SETTLE_USER_A" >"$OUTPUT_DIR/settle-user-a-$index" &
  pids+=("$!")
  reserve "$SETTLE_USER_B" >"$OUTPUT_DIR/settle-user-b-$index" &
  pids+=("$!")
done
for pid in "${pids[@]}"; do
  wait "$pid"
done
assert_equal 1 "$(count_prefix allowed "$OUTPUT_DIR"/settle-user-a-*)" "user A has one active reserved generation"
assert_equal 1 "$(count_prefix allowed "$OUTPUT_DIR"/settle-user-b-*)" "user B has one active reserved generation"

# ---------------------------------------------------------------------------
# Onboarding free reply: one generation per trial, one claim per account, however
# many separate sessions race. The v2 endpoint binds a trial to sha256(trial ID),
# so every request of a trial calls these functions with the same hash, and
# different trials have different hashes.
# ---------------------------------------------------------------------------
readonly HASH_A="$(printf 'a%.0s' $(seq 1 64))"
readonly HASH_B="$(printf 'b%.0s' $(seq 1 64))"
readonly HASH_C="$(printf 'c%.0s' $(seq 1 64))"
readonly HASH_D="$(printf 'd%.0s' $(seq 1 64))"
readonly TRIAL_BEGIN="00000000-0000-4000-8000-0000000009b1"
readonly TRIAL_FINALIZE="00000000-0000-4000-8000-0000000009b2"
readonly TRIAL_ONE="00000000-0000-4000-8000-0000000009b3"
readonly TRIAL_TWO="00000000-0000-4000-8000-0000000009b4"

trial_call() {
  local statement="$1"
  run_sql "
    set session_replication_role = replica;
    select ($statement)->>'status';
  "
}

run_parallel_trial_calls() {
  local prefix="$1"
  shift
  local index=0
  local pids=()
  for statement in "$@"; do
    index=$((index + 1))
    trial_call "$statement" >"$OUTPUT_DIR/$prefix-$index" &
    pids+=("$!")
  done
  for pid in "${pids[@]}"; do
    wait "$pid"
  done
}

claims_of() {
  run_sql "select count(*) from public.onboarding_ai_reply_claims where user_id = '$1'"
}

begin_trial_sql() {
  echo "public.begin_onboarding_device_trial('$1', '$2', '$3')"
}
store_trial_sql() {
  echo "public.store_onboarding_device_trial_result('$1', '$2', '$3', 'cipher', 'iv')"
}
finalize_trial_sql() {
  echo "public.finalize_onboarding_device_trial_v2('$1', '$2', '$3')"
}

begin_burst=()
for index in $(seq 1 30); do
  begin_burst+=("$(begin_trial_sql "$TRIAL_BEGIN_USER" "$TRIAL_BEGIN" "$HASH_A")")
done
run_parallel_trial_calls trial-begin "${begin_burst[@]}"
assert_equal 1 "$(count_status started "$OUTPUT_DIR"/trial-begin-*)" "one of 30 parallel onboarding requests for a trial starts generating"
assert_equal 29 "$(count_status generation_in_progress "$OUTPUT_DIR"/trial-begin-*)" "the other 29 see the trial in progress"
assert_equal 0 "$(claims_of "$TRIAL_BEGIN_USER")" "starting generation never consumes the free reply"
assert_equal t "$(run_sql "select public.abandon_onboarding_device_trial('$TRIAL_BEGIN_USER', '$TRIAL_BEGIN', '$HASH_A')")" "a failed generation abandons its trial"
assert_equal started "$(trial_call "$(begin_trial_sql "$TRIAL_BEGIN_USER" "$TRIAL_BEGIN" "$HASH_A")")" "a failed generation is abandoned and the trial can start again"
assert_equal 0 "$(claims_of "$TRIAL_BEGIN_USER")" "a retry after a failure still has its free reply"

trial_call "$(begin_trial_sql "$TRIAL_FINALIZE_USER" "$TRIAL_FINALIZE" "$HASH_B")" >/dev/null
trial_call "$(store_trial_sql "$TRIAL_FINALIZE_USER" "$TRIAL_FINALIZE" "$HASH_B")" >/dev/null
finalize_burst=()
for index in $(seq 1 30); do
  finalize_burst+=("$(finalize_trial_sql "$TRIAL_FINALIZE_USER" "$TRIAL_FINALIZE" "$HASH_B")")
done
run_parallel_trial_calls trial-finalize "${finalize_burst[@]}"
assert_equal 1 "$(count_status finalized "$OUTPUT_DIR"/trial-finalize-*)" "exactly one of 30 parallel finalizations consumes the reply"
assert_equal 29 "$(count_status replay "$OUTPUT_DIR"/trial-finalize-*)" "the other 29 replay the same reply"
assert_equal 1 "$(claims_of "$TRIAL_FINALIZE_USER")" "30 parallel finalizations make one account claim"
assert_equal 0 "$(attempts_of "$TRIAL_FINALIZE_USER")" "the free reply records no attempt against a plan allowance"

trial_call "$(begin_trial_sql "$TRIAL_TWO_TRIALS_USER" "$TRIAL_ONE" "$HASH_C")" >/dev/null
trial_call "$(begin_trial_sql "$TRIAL_TWO_TRIALS_USER" "$TRIAL_TWO" "$HASH_D")" >/dev/null
trial_call "$(store_trial_sql "$TRIAL_TWO_TRIALS_USER" "$TRIAL_ONE" "$HASH_C")" >/dev/null
trial_call "$(store_trial_sql "$TRIAL_TWO_TRIALS_USER" "$TRIAL_TWO" "$HASH_D")" >/dev/null
two_trials=()
for index in $(seq 1 10); do
  two_trials+=("$(finalize_trial_sql "$TRIAL_TWO_TRIALS_USER" "$TRIAL_ONE" "$HASH_C")")
  two_trials+=("$(finalize_trial_sql "$TRIAL_TWO_TRIALS_USER" "$TRIAL_TWO" "$HASH_D")")
done
run_parallel_trial_calls trial-two "${two_trials[@]}"
assert_equal 1 "$(count_status finalized "$OUTPUT_DIR"/trial-two-*)" "two ready trials of one account release exactly one reply"
assert_equal 1 "$(claims_of "$TRIAL_TWO_TRIALS_USER")" "racing trials of one account make one claim"
assert_equal 0 "$(attempts_of "$TRIAL_TWO_TRIALS_USER")" "racing trials of one account record no attempt"

echo "Separate-session AI generation concurrency checks passed (claim, reserve/settle and onboarding trials)."
