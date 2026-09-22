# Pie vs t3code: Markdown / chat image assets

Comparison of how Pie (PR #92) and t3code serve local filesystem and remote
images from assistant Markdown. The remote-image security addendum was checked
against t3code commit `aff9318bf` and merged PR `pingdotgg/t3code#11706`.

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

## Remote images and Electron CSP

### What t3code does

Ordinary t3code Markdown images do **not** go through its asset server. The
client classifier treats `http:`, `https:`, `data:`, `blob:`, and
protocol-relative URLs as `Direct`, and `ChatMarkdown` passes a direct source to
`<img>` or `<video>` (`packages/client-runtime/src/markdownImages.ts:11-47`,
`apps/web/src/components/ChatMarkdown.tsx:3139-3209`).

Its Electron policy deliberately permits both network schemes for images and
media:

```text
img-src 'self' t3code: blob: data: http: https:
media-src 'self' t3code: blob: http: https:
```

That policy is asserted in a regression test
(`apps/desktop/src/electron/ElectronProtocol.ts:71-102`,
`apps/desktop/src/electron/ElectronProtocol.test.ts:244-270`). The main window
still uses `contextIsolation: true`, `nodeIntegration: false`, and
`sandbox: true`; new windows are denied and cross-origin top-level navigation is
intercepted (`apps/desktop/src/window/DesktopWindow.ts:400-420,604-624`).

Therefore t3code has explicitly accepted scheme-level remote image loading in
its sandboxed renderer. It does not maintain a CDN-domain list.

### The GitHub proxy is narrower than it first appears

PR #11706 added a server proxy for **GitHub-hosted pull-request media**, not a
generic remote-image security proxy. Its PR description explicitly says
ordinary chat remains unchanged. `ChatMarkdown` only selects the proxy when its
`githubMedia` option is enabled; otherwise the same GitHub URL follows the
direct branch (`apps/web/src/components/ChatMarkdown.tsx:3141-3174`). The pull
request view enables that option
(`apps/web/src/components/pullRequest/PullRequestMarkdown.tsx:98-104`).

The proxy exists primarily so private repository images can use the host's
`gh` credential. It provides useful controls:

- only exact GitHub attachment, raw-file, and LFS URL shapes are accepted;
  ports, userinfo, and fragments are removed
  (`packages/shared/src/githubMedia.ts:14-53`);
- the resulting capability is signed and expires after one hour
  (`apps/server/src/assets/AssetAccess.ts:57-60,140-147,679-692,735-800`);
- redirects are followed manually, limited to three, and must stay HTTPS;
  the GitHub bearer token is attached only to four exact GitHub hosts and is
  never forwarded to the signed object store
  (`apps/server/src/assets/GitHubMediaFetch.ts:17-40,100-138`);
- only `Range` and `If-Range` are forwarded from the renderer, so browser
  cookies and referrers are not passed through this route
  (`apps/server/src/assets/GitHubMediaFetch.ts:42-51,144-155`);
- the response must classify as image, video, or audio, carries
  `X-Content-Type-Options: nosniff`, and SVG receives a restrictive response
  CSP (`apps/server/src/assets/GitHubMediaFetch.ts:52-57,156-196`).

The current implementation has no explicit response-size cap, download timeout,
magic-byte validation, or DNS/private-address check in `GitHubMediaFetch.ts`.
It streams the upstream body and may infer media type from the URL extension
when GitHub returns `application/octet-stream`. Those omissions are bounded by
the narrow accepted GitHub source URLs, but this code should not be generalized
to arbitrary user-supplied HTTPS URLs without adding SSRF and resource limits.

### What t3code does not eliminate

For ordinary direct images, t3code has the same residual properties as any
browser `<img src="https://…">`:

- the remote host sees a request from the user's network;
- tracking pixels and blind GET requests remain possible;
- decoding and memory costs occur in Chromium;
- no server-side size, MIME, magic-byte, or redirect policy runs;
- `ChatMarkdownImage` does not set `referrerPolicy` or `crossOrigin`.

The Electron sandbox prevents a decoded image from gaining Node access and CSP
continues to keep scripts host-restricted, but those controls do not make the
network request private or side-effect free. t3code is evidence that broad
`img-src` is a conscious product tradeoff, not evidence that it is risk-free.

### Implication for Pie PR #377

Pie already classifies arbitrary `http:` / `https:` Markdown destinations as
direct images on the web. Allowing `https:` in Electron makes Desktop match that
existing product behavior; it does not introduce a new parser or file-read
capability. Pie is slightly narrower than t3code because it still blocks remote
plain HTTP in packaged Electron and leaves `connect-src` restricted to the app
protocol and loopback.

Recommended scope for the current public GitHub attachment bug:

1. keep `img-src https:` rather than enumerating GitHub's changing redirect
   hosts;
2. keep remote `http:` blocked except the signed loopback asset server;
3. set `referrerPolicy="no-referrer"` on chat images to avoid leaking the chat
   document URL;
4. retain the existing signed, raster-only asset route for local files;
5. do not add a generic remote proxy solely for this bug—a local proxy still
   exposes the user's public IP and creates an SSRF surface that must be secured;
6. if Pie later needs private GitHub media, add a GitHub-specific resource like
   t3code's, with exact source URL validation and credential stripping, plus
   explicit byte and timeout limits before broadening it further.

If the product requirement changes to “assistant output must never contact a
remote host automatically,” neither t3code's policy nor `img-src https:` is
sufficient. The appropriate design is a blocked placeholder with an explicit
“Load remote image” action or a user setting, not a continually growing CSP
allowlist.

## Source map

| Concern               | t3code                                               | pie                                                    |
| --------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| Classify Markdown src | `packages/client-runtime/src/markdownImages.ts`      | `apps/app/.../transcript/chat-markdown.ts`             |
| `<img>` / mint UI     | `apps/web/src/components/ChatMarkdown.tsx` (+ media) | `apps/app/.../transcript/chat-markdown-image.tsx`      |
| Client URL helpers    | `apps/web/src/assets/assetUrls.ts`                   | `environmentRpc.httpBaseUrl` + `new URL(...)`          |
| Contract              | `packages/contracts/src/assets.ts`                   | `packages/contract/src/assets.ts`                      |
| Mint + verify         | `apps/server/src/assets/AssetAccess.ts`              | `packages/server/src/assets/service.ts`                |
| HTTP route            | `apps/server/src/http.ts` (`/api/assets`)            | `packages/server/src/http/app.ts`                      |
| Desktop CSP           | `apps/desktop/src/electron/ElectronProtocol.ts`      | `apps/desktop/src/renderer/index.html`                 |
| GitHub media proxy    | `apps/server/src/assets/GitHubMediaFetch.ts`         | Not implemented                                        |
| Design note           | PRs #6433 and #11706                                 | `docs/plans/2026-08-28-chat-image-rendering-design.md` |
