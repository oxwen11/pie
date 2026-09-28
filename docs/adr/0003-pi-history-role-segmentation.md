# Pi history and live output segment at user messages

Pi's internal turns are LLM round-trips, not user-visible replies. Segmenting on
`turn_end` or `stopReason` would split tool loops and retries into misleading
messages. Use user-message boundaries for both history and live output.

## Decision

- History receives the entry tree and `leafId` through Pi's process protocol.
  Follow `parentId` to reconstruct only the selected branch. A null, broken, or
  cyclic chain yields empty history rather than a fabricated transcript.
- Each user entry opens a user message. Subsequent assistant and tool-result
  entries form one assistant message until the next user entry.
- History ids are the user entry id or the segment's first assistant entry id.
  Live ids can differ; reconciliation replaces ids rather than assuming they match.
- Construct history `UIMessage` parts directly in the pure history fold. Do not
  replay synthetic chunks through a second stream state machine in production.
- Keep native entries inside the Pi integration. Session callers receive
  normalized messages; the session layer, not the pure fold, handles active-turn
  exclusion and snapshot composition.

## Live/history amendment

The original decision accepted different segmentation after steering. The
2026-08-02 probe disproved its premise: a delivered steer appears as a live
`message_start role=user`. Split on that marker so live and persisted history
agree, including follow-up input. Do not split on each tool-related Pi turn.
Parity tests must cover steered conversations, not exempt them.

## Field preservation

Text and plaintext thinking become completed text/reasoning parts. Pair tool
calls and results by the complete tool-call id, including across user boundaries;
keep unanswered calls as `input-available`. Use the same tool-result adaptation
as live output, including structured images ([ADR 0008](0008-chat-image-capabilities.md)).

History can carry additional model/provider/usage/stop-reason metadata. Empty
thinking backed only by encrypted provider data cannot be reconstructed and is
omitted, not represented by a fake empty part.

Compaction/branch summaries, custom messages, and bookkeeping entries are not
all rendered today. This is a known coverage gap, not evidence that those
entries contain no user-visible information.

Implementation and parity checks live in
[`history.ts`](../../packages/server/src/harness/pi/history.ts),
[`transform.ts`](../../packages/server/src/harness/pi/transform.ts), and
[`test/harness/pi/`](../../packages/server/test/harness/pi/).
