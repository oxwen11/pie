# PR diff: oversized files and large change sets

## Status

Skipped in the current pull-request Files tab.

## Current behavior

`pullRequest.diff` uses `gh pr diff --color never`. That is enough for ordinary pull requests.

When GitHub refuses the patch (HTTP 406 past ~300 files) or the output exceeds the 8 MiB cap, pie skips the preview and marks the diff truncated. Binary files and files whose hunks GitHub withholds are also skipped. The Files tab says the preview is incomplete; GitHub remains the full view.

## Follow-up

Match t3code’s fallback instead of skipping:

1. Page `GET /repos/{owner}/{repo}/pulls/{number}/files` (100 files per page) after `gh pr diff` is truncated or refused.
2. Assemble each page into a unified patch (`diff --git` headers around the files API `patch` field).
3. Optionally fetch omitted file contents so Pierre can expand context on files GitHub left out of the patch.
4. Keep paging a whole number of files; never cut a file in half at a byte boundary.

Until that lands, do not try to preview oversized files locally.
