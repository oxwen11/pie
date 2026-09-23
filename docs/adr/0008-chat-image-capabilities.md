# Render chat images without granting arbitrary file access

Chat has two distinct image sources: structured Pi tool results and local paths
inside assistant Markdown. Keep those paths separate; neither requires making
`pie://app` a filesystem reader.

## Decision

- Adapt structured Pi raster image blocks to AI SDK file parts with data URLs
  at the Pi boundary, using the same adaptation for live output and history.
  Generic tool cards must not reinterpret Pi's raw image payloads.
- Render ordinary approved remote image URLs normally. For local Markdown
  destinations, request a short-lived signed HTTP capability from the session's
  Environment. Join the returned relative URL against that Environment's HTTP
  base URL, not the Electron document origin.
- The server authorizes the exact destination against Markdown image nodes in
  settled assistant history for the complete SessionRef. Text mentions, code
  blocks, a different session, and arbitrary renderer-supplied paths do not
  authorize a read. Local capability requests wait for turn settlement.
- Resolve roots from authoritative session metadata. Canonicalize paths, enforce
  workspace/approved-temp-root containment, reject unsafe symlink traversal,
  and validate raster magic bytes and size before minting.
- Cache immutable image bytes at mint time; the capability binds the asset and
  content hash. GET serves that captured content, not a mutable path reopened
  from a signed filename. Expired or unknown capabilities do not read disk.
- SVG and arbitrary HTML are not admitted as raster images. Keep per-asset and
  process-cache limits; do not treat signed URLs as permission to expose any file.

## Consequences

The custom Electron protocol remains a renderer-document/static-asset origin.
There is no raw `file://` loading, generic media platform, or client-supplied cwd
as authority. Mint-time authorization adds a history check and delays local
Markdown images until settlement, in exchange for preventing the renderer from
turning the daemon into a file-probing API.

This records the boundary shipped in PR #92. The earlier implementation plan,
upstream comparison, and screenshots are not needed as parallel specifications.
