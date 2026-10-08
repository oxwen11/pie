#!/usr/bin/env bash
# Exercises tools/pr without calling GitHub. Bash 3.2.
set -euo pipefail

PR=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/pr-tools.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

BIN=$TMP/bin
ERR=$TMP/err
GH_LOG=$TMP/gh.log
GH_MERGED=$TMP/merged
GH_UPDATED=$TMP/updated
MAGICK_LOG=$TMP/magick.log
FFMPEG_LOG=$TMP/ffmpeg.log
mkdir -p "$BIN"
: > "$GH_LOG"
: > "$MAGICK_LOG"
: > "$FFMPEG_LOG"

HEAD_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
BASE_SHA=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
NEW_SHA=cccccccccccccccccccccccccccccccccccccccc
MERGE_SHA=dddddddddddddddddddddddddddddddddddddddd
OTHER_SHA=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
for sha in "$HEAD_SHA" "$BASE_SHA" "$NEW_SHA" "$MERGE_SHA" "$OTHER_SHA"; do
  test "$(printf '%s' "$sha" | wc -c | tr -d ' ')" = 40
done

export GH_LOG GH_MERGED GH_UPDATED MAGICK_LOG FFMPEG_LOG
export HEAD_SHA BASE_SHA NEW_SHA MERGE_SHA OTHER_SHA
export PATH="$BIN:$PATH"
unset PIE_HOME || true

cat > "$BIN/gh" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >> "$GH_LOG"
if [ "${GH_LEAK:-0}" = "1" ]; then
  echo "authorization failed ghp_LEAKEDTOKEN123" >&2
  exit 1
fi
case "$*" in
  *"pr checks"*)
    printf '%s\n' "$FIX_CHECKS"
    exit "${FIX_CHECKS_EXIT:-0}"
    ;;
  *"pr view"*)
    if [ -f "$GH_MERGED" ]; then
      printf '{"state":"MERGED","url":"https://github.com/oxwen11/pie/pull/1","headRefOid":"%s","mergeCommit":{"oid":"%s"}}\n' "${FIX_MERGED_HEAD:-$FIX_HEAD}" "$MERGE_SHA"
      exit 0
    fi
    if [ -f "$GH_UPDATED" ]; then
      printf '{"number":1,"url":"https://github.com/oxwen11/pie/pull/1","state":"OPEN","isDraft":false,"headRefOid":"%s","baseRefOid":"%s","baseRefName":"main","mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","reviewDecision":null}\n' "$NEW_SHA" "$FIX_BASE"
      exit 0
    fi
    printf '{"number":1,"url":"https://github.com/oxwen11/pie/pull/1","state":"%s","isDraft":%s,"headRefOid":"%s","baseRefOid":"%s","baseRefName":"main","mergeable":"%s","mergeStateStatus":"%s","reviewDecision":%s}\n' \
      "$FIX_STATE" "$FIX_DRAFT" "$FIX_HEAD" "$FIX_BASE" "$FIX_MERGEABLE" "$FIX_MERGE_STATE" "$FIX_REVIEW_JSON"
    exit 0
    ;;
  *"compare/"*)
    printf '{"behind_by":%s}\n' "${FIX_BEHIND:-0}"
    exit 0
    ;;
  *"update-branch"*)
    if [ "${FIX_SYNC_STICKY:-0}" != "1" ]; then
      touch "$GH_UPDATED"
    fi
    printf '%s\n' '{"message":"Updating pull request branch.","url":"https://api.github.com/repos/example"}'
    exit 0
    ;;
  *"stacks?"*)
    if [ "${FIX_STACK}" = "404" ]; then
      echo "HTTP 404: Not Found (HTTP 404)" >&2
      exit 1
    fi
    printf '%s\n' "$FIX_STACK"
    exit 0
    ;;
  *"merge-async/"*)
    if [ "${FIX_ASYNC}" = "pending" ]; then
      printf '%s\n' '{"status":"pending","details":{"uuid":"u-1"}}'
      exit 0
    fi
    touch "$GH_MERGED"
    printf '{"status":"merged","details":{"sha":"%s"}}\n' "$MERGE_SHA"
    exit 0
    ;;
  *"merge-async"*)
    printf '%s\n' '{"status":"pending","uuid":"u-1"}'
    exit 0
    ;;
  *"pr merge "*)
    if [ "${FIX_MERGE_EXIT:-0}" != "0" ]; then
      # Race: someone else merges a newer head while ours is refused.
      if [ -n "${FIX_MERGED_HEAD:-}" ]; then
        touch "$GH_MERGED"
      fi
      echo "merge refused" >&2
      exit "$FIX_MERGE_EXIT"
    fi
    touch "$GH_MERGED"
    exit 0
    ;;
  *"pr comment"*)
    exit 0
    ;;
  *)
    echo "fake-gh unhandled: $*" >&2
    exit 99
    ;;
esac
EOF

cat > "$BIN/magick" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >> "$MAGICK_LOG"
out=""
for out; do :; done
printf 'ok\n' > "$out"
EOF

cat > "$BIN/ffmpeg" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >> "$FFMPEG_LOG"
out=""
for out; do :; done
printf 'ok\n' > "$out"
EOF
chmod +x "$BIN/gh" "$BIN/magick" "$BIN/ffmpeg"

CODE=0
OUT=""
reset() {
  FIX_HEAD=$HEAD_SHA
  FIX_BASE=$BASE_SHA
  FIX_STATE=OPEN
  FIX_DRAFT=false
  FIX_MERGEABLE=MERGEABLE
  FIX_MERGE_STATE=CLEAN
  FIX_REVIEW_JSON=null
  FIX_BEHIND=0
  FIX_CHECKS='[{"name":"Code check","state":"SUCCESS","bucket":"pass","link":"https://example.test/check"}]'
  FIX_CHECKS_EXIT=0
  FIX_STACK=404
  FIX_ASYNC=merged
  FIX_SYNC_STICKY=0
  FIX_MERGE_EXIT=0
  FIX_MERGED_HEAD=
  GH_LEAK=0
  export FIX_HEAD FIX_BASE FIX_STATE FIX_DRAFT FIX_MERGEABLE FIX_MERGE_STATE FIX_REVIEW_JSON
  export FIX_BEHIND FIX_CHECKS FIX_CHECKS_EXIT FIX_STACK FIX_ASYNC FIX_SYNC_STICKY FIX_MERGE_EXIT FIX_MERGED_HEAD GH_LEAK
  rm -f "$GH_MERGED" "$GH_UPDATED"
  : > "$GH_LOG"
  : > "$MAGICK_LOG"
  : > "$FFMPEG_LOG"
  export PR_POLL_INTERVAL=0 PR_POLL_ATTEMPTS=2 PR_MERGEABLE_POLLS=0
}

run() {
  set +e
  OUT=$("$@" 2>"$ERR")
  CODE=$?
  set -e
}

run_in() {
  dir=$1
  shift
  set +e
  OUT=$(cd "$dir" && "$@" 2>"$ERR")
  CODE=$?
  set -e
}

expect_in() {
  want=$1
  dir=$2
  shift 2
  run_in "$dir" "$@"
  [ "$CODE" -eq "$want" ] || fail "$* wanted $want"
}

fail() {
  printf 'FAIL %s\n' "$*" >&2
  printf 'exit %s\n' "$CODE" >&2
  printf '%s\n' '--- stdout ---' "$OUT" '--- stderr ---' >&2
  cat "$ERR" >&2
  printf '%s\n' '--- gh log ---' >&2
  cat "$GH_LOG" >&2
  exit 1
}

expect_code() {
  want=$1
  shift
  run "$@"
  [ "$CODE" -eq "$want" ] || fail "$* wanted $want"
}

has() {
  printf '%s\n' "$OUT" | grep -q -- "$1" || fail "stdout missing: $1"
}

has_not_token() {
  if printf '%s\n' "$OUT" | grep -q 'ghp_LEAKEDTOKEN123'; then
    fail "token on stdout"
  fi
  if grep -q 'ghp_LEAKEDTOKEN123' "$ERR"; then
    fail "token on stderr"
  fi
}

log_has() { grep -q -- "$1" "$GH_LOG" || fail "log missing: $1"; }
log_not() { if grep -q -- "$1" "$GH_LOG"; then fail "log unexpected: $1"; fi; }

step() { printf '%s\n' "$1"; }

step help
for cmd in pr-status pr-sync pr-worktree pr-merge pr-session redact-evidence; do
  expect_code 0 "$PR/$cmd" --help
  has "Usage:"
done

step status-ready
reset
expect_code 0 "$PR/pr-status" 12 --repo oxwen11/pie
has "head: $HEAD_SHA"
has "behind: 0"
has "mergeable: MERGEABLE"
has "result: ready"
has "Code check: pass"

step status-behind
reset
FIX_BEHIND=2
export FIX_BEHIND
expect_code 1 "$PR/pr-status" 12 --repo oxwen11/pie
has "behind: 2"
has "result: blocked"
has "reason: behind base by 2"

step status-pending
reset
FIX_CHECKS='[{"name":"Code check","state":"PENDING","bucket":"pending","link":"https://example.test/check"}]'
export FIX_CHECKS
expect_code 1 "$PR/pr-status" 12 --repo oxwen11/pie
has "reason: required checks are not all passing"

step status-empty-checks
reset
FIX_CHECKS='[]'
export FIX_CHECKS
expect_code 1 "$PR/pr-status" 12 --repo oxwen11/pie
has "reason: no required checks reported"

step status-changes
reset
FIX_REVIEW_JSON='"CHANGES_REQUESTED"'
export FIX_REVIEW_JSON
expect_code 1 "$PR/pr-status" 12 --repo oxwen11/pie
has "reason: changes requested"

step status-draft
reset
FIX_DRAFT=true
export FIX_DRAFT
expect_code 1 "$PR/pr-status" 12 --repo oxwen11/pie
has "reason: draft"

step status-scrub
reset
GH_LEAK=1
export GH_LEAK
expect_code 1 "$PR/pr-status" 12 --repo oxwen11/pie
has_not_token
grep -q '\[redacted\]' "$ERR" || fail "stderr was not scrubbed"

step sync-mismatch
reset
expect_code 1 "$PR/pr-sync" 12 --repo oxwen11/pie --sha "$OTHER_SHA"
log_not update-branch

step sync-current
reset
expect_code 0 "$PR/pr-sync" 12 --repo oxwen11/pie --sha "$HEAD_SHA"
has "up to date: $HEAD_SHA"
log_not update-branch

step sync-update
reset
FIX_BEHIND=3
export FIX_BEHIND
expect_code 0 "$PR/pr-sync" 12 --repo oxwen11/pie --sha "$HEAD_SHA"
has "head: $NEW_SHA"
log_has "expected_head_sha=$HEAD_SHA"

step sync-unverified
reset
FIX_BEHIND=3
FIX_SYNC_STICKY=1
export FIX_BEHIND FIX_SYNC_STICKY
expect_code 2 "$PR/pr-sync" 12 --repo oxwen11/pie --sha "$HEAD_SHA"
grep -q unverified "$ERR" || fail "missing unverified"
log_has update-branch

step merge-plain
reset
expect_code 0 "$PR/pr-merge" 12 --repo oxwen11/pie --sha "$HEAD_SHA"
has "merged: $MERGE_SHA"
log_has "pr merge "
log_has "--squash"
log_has "--match-head-commit $HEAD_SHA"
log_has "Merged as $MERGE_SHA"
log_not --admin
log_not --auto
log_not bypass_rules
log_not merge-async
count=$(grep -c 'pr merge ' "$GH_LOG" || true)
[ "$count" = 1 ] || fail "merged more than once ($count)"

step merge-blocked
reset
FIX_CHECKS='[]'
export FIX_CHECKS
expect_code 1 "$PR/pr-merge" 12 --repo oxwen11/pie --sha "$HEAD_SHA"
log_not "pr merge "
log_not merge-async

step merge-sha
reset
expect_code 1 "$PR/pr-merge" 12 --repo oxwen11/pie --sha "$OTHER_SHA"
log_not "pr merge "

step merge-conflicting
reset
FIX_MERGEABLE=CONFLICTING
export FIX_MERGEABLE
expect_code 1 "$PR/pr-merge" 12 --repo oxwen11/pie --sha "$HEAD_SHA"
grep -q 'mergeable is CONFLICTING' "$ERR" || fail "missing conflict reason"
log_not "pr merge "

step merge-checks-failed
reset
FIX_CHECKS='[{"name":"Code check","state":"FAILURE","bucket":"fail","link":"https://example.test/check"}]'
export FIX_CHECKS
expect_code 1 "$PR/pr-merge" 12 --repo oxwen11/pie --sha "$HEAD_SHA"
grep -q 'required checks are not all passing' "$ERR" || fail "missing checks reason"
log_not "pr merge "

step merge-behind
reset
FIX_BEHIND=1
export FIX_BEHIND
expect_code 1 "$PR/pr-merge" 12 --repo oxwen11/pie --sha "$HEAD_SHA"
grep -q 'behind base by 1' "$ERR" || fail "missing behind reason"
log_not "pr merge "

step merge-refused-race
reset
FIX_MERGE_EXIT=1
FIX_MERGED_HEAD=$OTHER_SHA
export FIX_MERGE_EXIT FIX_MERGED_HEAD
expect_code 2 "$PR/pr-merge" 12 --repo oxwen11/pie --sha "$HEAD_SHA"
log_not "pr comment"
if printf '%s\n' "$OUT" | grep -q merged; then fail "reported a merge"; fi

step merge-other-head
reset
FIX_MERGED_HEAD=$OTHER_SHA
export FIX_MERGED_HEAD
expect_code 1 "$PR/pr-merge" 12 --repo oxwen11/pie --sha "$HEAD_SHA"
grep -q "merged at head $OTHER_SHA" "$ERR" || fail "missing head mismatch"
log_not "pr comment"

step merge-refused
reset
FIX_MERGE_EXIT=1
export FIX_MERGE_EXIT
expect_code 2 "$PR/pr-merge" 12 --repo oxwen11/pie --sha "$HEAD_SHA"
grep -q unverified "$ERR" || fail "missing unverified"
log_not "pr comment"
count=$(grep -c 'pr merge ' "$GH_LOG" || true)
[ "$count" = 1 ] || fail "retried merge ($count)"

STACK_JSON="[{\"number\":1,\"pull_requests\":[{\"number\":10,\"state\":\"open\",\"merged_at\":null,\"head\":{\"ref\":\"bottom\",\"sha\":\"$HEAD_SHA\"}},{\"number\":11,\"state\":\"open\",\"merged_at\":null,\"head\":{\"ref\":\"top\",\"sha\":\"$OTHER_SHA\"}}]}]"

step merge-stack
reset
FIX_STACK=$STACK_JSON
export FIX_STACK
expect_code 0 "$PR/pr-merge" 10 --repo oxwen11/pie --sha "$HEAD_SHA"
has "merged: $MERGE_SHA"
log_has "merge-async"
log_has "merge_method=squash"
log_has "sha=$HEAD_SHA"
log_not "merge_action"
log_not "pr merge "
log_not bypass_rules

step merge-downstack
reset
FIX_HEAD=$OTHER_SHA
FIX_STACK=$STACK_JSON
export FIX_HEAD FIX_STACK
expect_code 1 "$PR/pr-merge" 11 --repo oxwen11/pie --sha "$OTHER_SHA"
grep -q 'open downstack' "$ERR" || fail "missing downstack reason"
log_not "pr merge "
log_not merge-async

step merge-pending
reset
FIX_STACK="[{\"number\":1,\"pull_requests\":[{\"number\":10,\"state\":\"open\",\"merged_at\":null,\"head\":{\"ref\":\"bottom\",\"sha\":\"$HEAD_SHA\"}}]}]"
FIX_ASYNC=pending
export FIX_STACK FIX_ASYNC
expect_code 2 "$PR/pr-merge" 10 --repo oxwen11/pie --sha "$HEAD_SHA"
grep -q unverified "$ERR" || fail "missing unverified"
log_not "pr comment"
log_not "pr merge "

step session
reset
HOME=$TMP/home
mkdir -p "$HOME/.pie/storage/sessions/p1" "$HOME/.pie_dev/storage/sessions/p2" "$HOME/.pie/storage/sessions/p3"
cat > "$HOME/.pie/storage/sessions/p1/s1.json" <<EOF
{"version":1,"data":{"sessionId":"s1","projectId":"p1","title":"visible","cwd":"/tmp/work","pullRequests":[{"ref":{"host":"github.com","owner":"oxwen11","repository":"pie","number":424},"source":"agent","linkedAt":"2026-01-01T00:00:00Z","excluded":false,"snapshot":{"token":"ghp_LEAKEDTOKEN123"},"stack":null,"stackCheckedAt":null}],"pullRequestRefs":[{"host":"github.com","owner":"oxwen11","repository":"pie","number":7}]}}
EOF
cat > "$HOME/.pie_dev/storage/sessions/p2/s2.json" <<EOF
{"version":1,"data":{"sessionId":"s2","projectId":"p2","title":"legacy","cwd":"/tmp/legacy","pullRequestRefs":[{"host":"github.com","owner":"oxwen11","repository":"pie","number":424}]}}
EOF
cat > "$HOME/.pie/storage/sessions/p3/other.json" <<EOF
{"version":1,"data":{"sessionId":"s3","projectId":"p3","title":"other","pullRequests":[{"ref":{"host":"github.com","owner":"oxwen11","repository":"pie","number":9},"source":"agent","linkedAt":"2026-01-01T00:00:00Z","excluded":false,"snapshot":{"token":"ghp_LEAKEDTOKEN123"},"stack":null,"stackCheckedAt":null}]}}
EOF
printf '{\n' > "$HOME/.pie/storage/sessions/p1/bad.json"
printf '%s\n' '{"version":1,"data":{"pullRequests":"oops"}}' > "$HOME/.pie/storage/sessions/p1/odd.json"
export HOME
unset PIE_HOME || true
expect_code 0 "$PR/pr-session" 424
has '"title":"visible"'
has '"title":"legacy"'
has '"source":"pullRequestRefs"'
has_not_token
if printf '%s\n' "$OUT" | grep -q '"title":"other"'; then
  fail "unrelated session matched"
fi
grep -q 'skip unreadable .*bad.json' "$ERR" || fail "bad session was not skipped"
grep -q 'skip unreadable .*odd.json' "$ERR" || fail "odd session was not skipped"

step session-pie-home
PIE_HOME=$TMP/only
mkdir -p "$PIE_HOME/storage/sessions/p9"
cat > "$PIE_HOME/storage/sessions/p9/s9.json" <<EOF
{"version":1,"data":{"sessionId":"s9","projectId":"p9","title":"only-home","cwd":"/tmp/only","pullRequests":[{"ref":{"host":"github.com","owner":"oxwen11","repository":"pie","number":424},"source":"branch","linkedAt":"2026-01-02T00:00:00Z","excluded":true,"snapshot":null,"stack":null,"stackCheckedAt":null}]}}
EOF
export PIE_HOME
expect_code 0 "$PR/pr-session" 424
has '"title":"only-home"'
has '"excluded":true'
if printf '%s\n' "$OUT" | grep -q '"title":"visible"'; then
  fail "PIE_HOME did not limit the scan"
fi
unset PIE_HOME || true

step worktree
reset
ORIGIN=$TMP/origin.git
PRIMARY=$TMP/primary
git init --bare -b main "$ORIGIN" >/dev/null
git init -b main "$PRIMARY" >/dev/null
git -C "$PRIMARY" config user.email "pr-test@example.com"
git -C "$PRIMARY" config user.name "pr-test"
echo a > "$PRIMARY/a.txt"
git -C "$PRIMARY" add a.txt
git -C "$PRIMARY" -c commit.gpgsign=false commit -m init >/dev/null
git -C "$PRIMARY" remote add origin "$ORIGIN"
git -C "$PRIMARY" push -u origin main >/dev/null
GIT_SHA=$(git -C "$PRIMARY" rev-parse HEAD)
git -C "$PRIMARY" push origin "HEAD:refs/pull/7/head" >/dev/null
FIX_HEAD=$GIT_SHA
export FIX_HEAD
DEST=$TMP/wt-ok
expect_in 0 "$PRIMARY" "$PR/pr-worktree" 7 --repo oxwen11/pie --sha "$GIT_SHA" --dest "$DEST"
has "head: $GIT_SHA"
test "$(git -C "$DEST" rev-parse HEAD)" = "$GIT_SHA"
test "$(git -C "$PRIMARY" rev-parse --abbrev-ref HEAD)" = "main"
expect_in 1 "$PRIMARY" "$PR/pr-worktree" 7 --repo oxwen11/pie --sha "$GIT_SHA" --dest "$PRIMARY/inside"
grep -q 'inside the current checkout' "$ERR" || fail "dest inside checkout was allowed"
expect_in 1 "$PRIMARY" "$PR/pr-worktree" 7 --repo oxwen11/pie --sha "$OTHER_SHA" --dest "$TMP/wt-bad"
grep -q 'expected' "$ERR" || fail "sha mismatch was allowed"
test ! -e "$TMP/wt-bad"

step redact
reset
printf 'x\n' > "$TMP/shot.PNG"
expect_code 0 "$PR/redact-evidence" --crop 8x8+0+0 "$TMP/shot.PNG"
has "$TMP/shot.redacted.png"
grep -q -- '-crop 8x8+0+0' "$MAGICK_LOG" || fail "magick crop missing"
expect_code 1 "$PR/redact-evidence" --crop 8x8+0+0 "$TMP/shot.PNG"
grep -q 'output exists' "$ERR" || fail "overwrite was allowed"
printf 'x\n' > "$TMP/clip.webm"
expect_code 1 "$PR/redact-evidence" --blur 2x2+0+0 "$TMP/clip.webm"
grep -q 'image-only' "$ERR" || fail "video blur was allowed"
expect_code 0 "$PR/redact-evidence" --crop 8x8+1+1 "$TMP/clip.webm"
has "$TMP/clip.redacted.webm"
grep -q 'libvpx' "$FFMPEG_LOG" || fail "webm codec missing"
grep -q 'crop=8:8:1:1' "$FFMPEG_LOG" || fail "ffmpeg crop missing"
: > "$MAGICK_LOG"
mkdir -p "$TMP/dash"
printf 'x\n' > "$TMP/dash/-x.png"
run_in "$TMP/dash" "$PR/redact-evidence" --crop 8x8+0+0 -- -x.png
[ "$CODE" -eq 0 ] || fail "dash file failed"
has "./-x.redacted.png"
grep -q '^\./-x.png ' "$MAGICK_LOG" || fail "dash file reached magick as an option"
