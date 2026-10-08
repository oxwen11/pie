# Shared helpers for tools/pr. Callers set -euo pipefail first. Bash 3.2.

die() {
  printf 'pr: %s\n' "$*" >&2
  exit 1
}

unverified() {
  printf 'pr: unverified: %s\n' "$*" >&2
  exit 2
}

scrub() {
  sed -E 's/(gho_|ghp_|ghs_|github_pat_)[A-Za-z0-9_]+/[redacted]/g'
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

pr_cleanup() {
  rm -f "${GH_STDOUT_FILE:-}" "${GH_STDERR_FILE:-}" "${PR_CHECKS_FILE:-}" "${PR_STACK_FILE:-}"
}

pr_init() {
  PR_CHECKS_FILE=$(mktemp "${TMPDIR:-/tmp}/pr-checks.XXXXXX")
  PR_STACK_FILE=$(mktemp "${TMPDIR:-/tmp}/pr-stack.XXXXXX")
  trap pr_cleanup EXIT
}

require_remote() {
  printf '%s\n' "$1" | grep -Eq '^[A-Za-z0-9._/-]+$' || die "invalid --remote"
  REMOTE=$1
}

gh_run() {
  rm -f "${GH_STDOUT_FILE:-}" "${GH_STDERR_FILE:-}"
  GH_STDOUT_FILE=$(mktemp "${TMPDIR:-/tmp}/pr-stdout.XXXXXX")
  GH_STDERR_FILE=$(mktemp "${TMPDIR:-/tmp}/pr-stderr.XXXXXX")
  set +e
  gh "$@" >"$GH_STDOUT_FILE" 2>"$GH_STDERR_FILE"
  GH_STATUS=$?
  set -e
}

show_gh_err() {
  scrub <"$GH_STDERR_FILE" >&2
}

json_object() {
  jq -e 'type == "object"' "$1" >/dev/null 2>/dev/null
}

set_repo() {
  REPO=$1
  case "$REPO" in
    */*/*) API_REPO=${REPO#*/} ;;
    */*) API_REPO=$REPO ;;
    *) die "invalid --repo (want OWNER/REPO)" ;;
  esac
  printf '%s\n' "$API_REPO" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' \
    || die "invalid --repo"
}

default_repo() {
  if [ -n "${REPO:-}" ]; then
    return 0
  fi
  gh_run repo view --json nameWithOwner
  if [ "$GH_STATUS" -ne 0 ] || ! json_object "$GH_STDOUT_FILE"; then
    show_gh_err
    die "gh repo view failed"
  fi
  set_repo "$(jq -r '.nameWithOwner // empty' "$GH_STDOUT_FILE")"
}

require_number() {
  printf '%s\n' "${1:-}" | grep -Eq '^[1-9][0-9]*$' || die "expected a pull request number"
  NUMBER=$1
}

is_sha() {
  printf '%s\n' "${1:-}" | grep -Eq '^[0-9a-fA-F]{40}$|^[0-9a-fA-F]{64}$'
}

require_sha() {
  is_sha "${1:-}" || die "expected a commit SHA"
}

sha_eq() {
  [ "$(printf '%s' "$1" | tr 'A-F' 'a-f')" = "$(printf '%s' "$2" | tr 'A-F' 'a-f')" ]
}

load_pull_request() {
  local tries=0
  local limit="${PR_MERGEABLE_POLLS:-5}"
  while true; do
    load_view "$1"
    load_checks "$1"
    load_behind
    if [ "$PR_MERGEABLE" != "UNKNOWN" ] || [ "$tries" -ge "$limit" ]; then
      break
    fi
    tries=$((tries + 1))
    sleep "${PR_POLL_INTERVAL:-1}"
  done
}

load_view() {
  gh_run pr view "$1" --repo "$REPO" --json \
    number,url,state,isDraft,headRefOid,baseRefOid,baseRefName,mergeable,mergeStateStatus,reviewDecision
  if [ "$GH_STATUS" -ne 0 ] || ! json_object "$GH_STDOUT_FILE"; then
    show_gh_err
    die "gh pr view failed"
  fi
  PR_HEAD=$(jq -r '.headRefOid // empty' "$GH_STDOUT_FILE")
  PR_BASE_OID=$(jq -r '.baseRefOid // empty' "$GH_STDOUT_FILE")
  PR_BASE_NAME=$(jq -r '.baseRefName // empty' "$GH_STDOUT_FILE")
  PR_STATE=$(jq -r '.state // empty' "$GH_STDOUT_FILE")
  PR_URL=$(jq -r '.url // empty' "$GH_STDOUT_FILE")
  PR_DRAFT=$(jq -r 'if .isDraft then "true" else "false" end' "$GH_STDOUT_FILE")
  PR_MERGEABLE=$(jq -r 'if .mergeable == null or .mergeable == "" then "UNKNOWN" else .mergeable end' "$GH_STDOUT_FILE")
  PR_MERGE_STATE=$(jq -r 'if .mergeStateStatus == null or .mergeStateStatus == "" then "unknown" else .mergeStateStatus end' "$GH_STDOUT_FILE")
  PR_REVIEW=$(jq -r 'if .reviewDecision == null or .reviewDecision == "" then "none" else .reviewDecision end' "$GH_STDOUT_FILE")
  is_sha "$PR_HEAD" || die "pull request head is not a SHA"
  [ -n "$PR_BASE_NAME" ] || die "pull request has no base branch"
}

load_checks() {
  gh_run pr checks "$1" --repo "$REPO" --required --json name,state,bucket,link
  if ! jq -e 'type == "array"' "$GH_STDOUT_FILE" >/dev/null 2>/dev/null; then
    show_gh_err
    die "could not read required checks"
  fi
  cp "$GH_STDOUT_FILE" "$PR_CHECKS_FILE"
  PR_CHECK_COUNT=$(jq 'length' "$PR_CHECKS_FILE")
  PR_CHECK_BAD=$(jq '[.[] | select(.bucket != "pass" or (.state != "SUCCESS" and .state != "success"))] | length' "$PR_CHECKS_FILE")
}

load_behind() {
  local base head spec
  base=$(jq -nr --arg v "$PR_BASE_NAME" '$v|@uri')
  head=$(jq -nr --arg v "$PR_HEAD" '$v|@uri')
  spec="${base}...${head}"
  gh_run api "repos/${API_REPO}/compare/${spec}"
  if [ "$GH_STATUS" -ne 0 ] || ! json_object "$GH_STDOUT_FILE"; then
    show_gh_err
    die "could not compare ${PR_BASE_NAME}...head"
  fi
  PR_BEHIND=$(jq -r '.behind_by // empty' "$GH_STDOUT_FILE")
  case "$PR_BEHIND" in
    ''|*[!0-9]*) die "invalid behind_by" ;;
  esac
}

pr_ready() {
  if [ "$PR_STATE" != "OPEN" ]; then
    PR_REASON="state is $PR_STATE"
    return 1
  fi
  if [ "$PR_DRAFT" != "false" ]; then
    PR_REASON="draft"
    return 1
  fi
  if [ "$PR_MERGEABLE" != "MERGEABLE" ]; then
    PR_REASON="mergeable is $PR_MERGEABLE"
    return 1
  fi
  if [ "$PR_BEHIND" -ne 0 ]; then
    PR_REASON="behind base by $PR_BEHIND"
    return 1
  fi
  if [ "$PR_REVIEW" = "CHANGES_REQUESTED" ]; then
    PR_REASON="changes requested"
    return 1
  fi
  if [ "$PR_CHECK_COUNT" -eq 0 ]; then
    PR_REASON="no required checks reported"
    return 1
  fi
  if [ "$PR_CHECK_BAD" -ne 0 ]; then
    PR_REASON="required checks are not all passing"
    return 1
  fi
  PR_REASON=""
  return 0
}

print_report() {
  printf 'number: %s\n' "$NUMBER"
  printf 'repo: %s\n' "$REPO"
  printf 'url: %s\n' "$PR_URL"
  printf 'state: %s\n' "$PR_STATE"
  printf 'draft: %s\n' "$PR_DRAFT"
  printf 'head: %s\n' "$PR_HEAD"
  printf 'base: %s (%s)\n' "$PR_BASE_OID" "$PR_BASE_NAME"
  printf 'behind: %s\n' "$PR_BEHIND"
  printf 'mergeable: %s\n' "$PR_MERGEABLE"
  printf 'mergeStateStatus: %s\n' "$PR_MERGE_STATE"
  printf 'reviewDecision: %s\n' "$PR_REVIEW"
  printf 'checks:\n'
  jq -r '.[] | "  - \(.name): \(.bucket) \(.state) \(.link // "")"' "$PR_CHECKS_FILE"
  if pr_ready; then
    printf 'result: ready\n'
  else
    printf 'result: blocked\nreason: %s\n' "$PR_REASON"
  fi
}

detect_stack() {
  local count member below
  STACKED=0
  gh_run api "repos/${API_REPO}/stacks?pull_request=${NUMBER}"
  if [ "$GH_STATUS" -ne 0 ]; then
    if grep -q '404' "$GH_STDERR_FILE" || grep -q '404' "$GH_STDOUT_FILE"; then
      return 0
    fi
    show_gh_err
    die "stack lookup failed"
  fi
  count=$(jq 'if type == "array" then length else -1 end' "$GH_STDOUT_FILE")
  if [ "$count" -eq 0 ]; then
    return 0
  fi
  if [ "$count" -ne 1 ]; then
    die "ambiguous stack response"
  fi
  # pull_requests is bottom to top, so earlier rows are downstack.
  jq -r '.[0].pull_requests[] | [.number, (.head.sha // ""), (.state // ""), (.merged_at // "")] | @tsv' \
    "$GH_STDOUT_FILE" >"$PR_STACK_FILE"
  member=$(awk -v n="$NUMBER" '$1 == n { print $2; exit }' "$PR_STACK_FILE")
  [ -n "$member" ] || die "stack response is missing this pull request head"
  sha_eq "$member" "$PR_HEAD" || die "stack head does not match the pull request head"
  below=$(awk -v n="$NUMBER" '
    $1 == n { found = 1; exit }
    $3 == "open" && $4 == "" { list = list (list ? "," : "") $1 }
    END { if (!found) print "missing"; else print list }
  ' "$PR_STACK_FILE")
  [ "$below" != "missing" ] || die "stack response is missing this pull request"
  if [ -n "$below" ]; then
    die "open downstack pull request(s) $below would merge with #$NUMBER"
  fi
  STACKED=1
}

require_ready_sha() {
  load_pull_request "$NUMBER"
  if ! pr_ready; then
    print_report | scrub >&2
    die "$PR_REASON"
  fi
  sha_eq "$PR_HEAD" "$EXPECTED" || die "head is $PR_HEAD, expected $EXPECTED"
}
