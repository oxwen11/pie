# Pie vs t3code: Markdown / chat image assets

Comparison of how Pie (PR #92) and t3code (`pingdotgg/t3code#6433`, commit
`77c9d1eb5` and current `AssetAccess` / `markdownImages`) serve local filesystem
images from assistant Markdown. Source for t3code was read from a local checkout
and mirrored under `/tmp/t3-assets-compare/`.

## Shared decision

Both keep the custom app protocol (`pie://app` / `t3code://`) as the **renderer
document origin only**. Neither turns that protocol into a local-file reader.
Neither passes raw `file://` or absolute paths to `<img>`.

Both:

1. classify the Markdown image destination on the client;
2. mint a short-lived signed HTTP capability on the environment host;
3. resolve `relativeUrl` against the environment `httpBaseUrl`;
4. render with a normal `<img>` under CSP that already allows loopback HTTP.

## Summary table

|                          | t3code                                                                | pie (PR #92)                                                                                        |
| ------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Problem solved**       | Workspace / media / attachments / favicons / GitHub media / icons     | Assistant Markdown local images (+ separate Pi tool `ImageContent` path)                            |
| **Mint RPC input**       | `AssetResource` tagged union                                          | `{ ref: SessionRef, destination: string }`                                                          |
| **Identity root**        | `threadId` / explicit `cwd` on the resource                           | Full `SessionRef`; server loads stored session `cwd`                                                |
| **Who may mint**         | Caller that can name an allowed resource                              | Only if destination is an exact Markdown `image` node in settled assistant history for that session |
| **While streaming**      | Resource mint anytime the connection allows                           | Client disables mint while `turnInProgress`                                                         |
| **Token TTL**            | 60 minutes (`ASSET_TOKEN_TTL_MS`)                                     | 5 minutes                                                                                           |
| **Serve model**          | Mostly open/resolve file again from signed claims                     | Immutable bytes cached at mint; token binds `assetId` + `contentHash`                               |
| **Path containment**     | Workspace / media-exact / inode-aware claim kinds                     | `realpath` under session `cwd` ∪ temp roots; `O_NOFOLLOW`; re-check after open                      |
| **Type gate**            | Extension / preview allowlists (+ header dims for images)             | Magic-byte raster only: PNG/JPEG/GIF/WebP/BMP; reject SVG                                           |
| **Size**                 | Per attachment / preview limits elsewhere                             | 20 MiB per asset; 128 MiB process cache                                                             |
| **Client classifier**    | `classifyMarkdownImageSource(value, workspaceRoot?)`                  | `classifyMarkdownImageSource` + remark rewrite to `https://pie-local.invalid/`                      |
| **Relative paths**       | Client may join against `workspaceRoot`                               | Client passes destination as-is; server resolves against stored `cwd`                               |
| **URL assembly**         | Effect atom `createUrl` + `resolveAssetUrl(httpBaseUrl, relativeUrl)` | TanStack Query `assets.createUrl` + `new URL(relativeUrl, httpBaseUrl)`                             |
| **Structured tool imgs** | Folded into broader media / attachment pipeline                       | Separate: Pi `ImageContent` → AI SDK `FileUIPart` data URLs at harness boundary                     |
| **Surface area**         | Large (`AssetAccess.ts` ~800+ lines, many claim kinds)                | Narrow (`SessionImageAssets` ~400 lines, one claim kind)                                            |

## What pie deliberately copied

- Transport boundary: signed loopback HTTP, not the custom protocol.
- Client classification before mint: direct / local / blocked.
- Server-side path hardening: canonicalize, reject escape and symlink tricks, validate previewable bytes.
- Environment `httpBaseUrl` for joining the relative capability URL (required in packaged Electron where the document origin is `pie://app`).

## What pie deliberately did not copy

**Generic asset platform.** t3code's `AssetResource` covers workspace files, arbitrary media files, draft cwd files, chat attachments, project favicons, native app icons, and GitHub media. Pie only mints URLs for destinations that already appear as Markdown image nodes in that session's settled assistant text.

**Client-supplied cwd / thread path authority.** t3code often carries path or `cwd` inside the resource the client sends. Pie's client sends the original destination string; the server resolves against authoritative session metadata and refuses paths that are not referenced in history. That is the main security narrowing: a compromised renderer holding a valid connection cannot probe arbitrary project files by inventing paths.

**Open-on-GET file serving.** t3code signs claims that later re-open the file (workspace-exact, media-exact with device/inode, etc.). Pie reads once at mint, caches immutable bytes, and serves only from that cache. Expired or unknown tokens return nothing; there is no residual "read this path" capability after the cache entry is gone.

**Long TTL and rich media.** Pie uses a short TTL and raster-only magic checks. Video, PDF, HTML preview, favicons, and GitHub-authenticated media stay out of scope.

**Relative-path joining on the client.** t3code can join relative Markdown destinations against a known workspace root before minting. Pie leaves relative resolution on the server so the client never needs a cwd for authorization.

## Two image forms in pie

```text
structured Pi tool image
  → Pi ImageContent
  → AI SDK FileUIPart
  → data:image/<type>;base64,...

assistant Markdown local image
  → classify → assets.createUrl(SessionRef, destination)
  → /api/assets/<token>/<filename>
  → <img>
```

t3code largely routes authored media through one `AssetResource` / media-source stack. Pie keeps the tool-result path as data URLs at the harness adapter and only uses signed HTTP for Markdown filesystem destinations.

## When to grow toward t3code

Add claim kinds / open-on-GET / richer `AssetResource` shapes only when pie needs:

- non-Markdown consumers of the same bytes (attachments, favicons, native icons);
- files that must stay on disk and be re-read after process restart without reminting from history;
- video or document preview;
- authenticated third-party media fetch.

Until then the history-gated, cache-at-mint design is the smaller trusted surface for the chat Markdown bug.

## Source map

| Concern               | t3code                                               | pie                                                    |
| --------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| Classify Markdown src | `packages/client-runtime/src/markdownImages.ts`      | `apps/app/.../transcript/chat-markdown.ts`             |
| `<img>` / mint UI     | `apps/web/src/components/ChatMarkdown.tsx` (+ media) | `apps/app/.../transcript/chat-markdown-image.tsx`      |
| Client URL helpers    | `apps/web/src/assets/assetUrls.ts`                   | `environmentRpc.httpBaseUrl` + `new URL(...)`          |
| Contract              | `packages/contracts/src/assets.ts`                   | `packages/contract/src/assets.ts`                      |
| Mint + verify         | `apps/server/src/assets/AssetAccess.ts`              | `packages/server/src/assets/service.ts`                |
| HTTP route            | `apps/server/src/http.ts` (`/api/assets`)            | `packages/server/src/http/app.ts`                      |
| Design note           | PR #6433                                             | `docs/plans/2026-08-28-chat-image-rendering-design.md` |
