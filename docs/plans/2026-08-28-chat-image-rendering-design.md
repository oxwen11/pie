# Chat Image Rendering — Design

## Status

Approved design for completing chat image rendering across structured Pi tool results and assistant Markdown.

The first implementation already renders structured raster image blocks returned by tools. The remaining work renders local image paths embedded in assistant text without turning `pie://app` or the local HTTP server into an arbitrary file reader.

## Goal

Render both image forms observed in Pi sessions:

1. Structured image blocks returned by tools.
2. Markdown images in assistant text whose destination is a local file path.

The same assistant message must work in:

- the browser app;
- Electron development, where Vite serves the renderer document;
- packaged Electron, where the renderer origin is `pie://app`;
- live streaming;
- replayed Pi history.

## Observed Pi Data

### Structured tool result

Pi persists image-producing `read` results as text plus base64 data:

```json
{
  "role": "toolResult",
  "toolName": "read",
  "content": [
    {
      "type": "text",
      "text": "Read image file [image/png]"
    },
    {
      "type": "image",
      "data": "<base64>",
      "mimeType": "image/png"
    }
  ]
}
```

The Pi-to-AI-SDK adapter owns this form. It maps approved Pi `ImageContent` blocks to first-class AI SDK `FileUIPart` values with data URLs, while the tool output retains its typed text content and details. `AssistantMessage` renders approved raster file parts; `DynamicToolPart` remains a generic tool-output renderer and does not know Pi's result shape.

### Assistant Markdown image

Pi also persists assistant text that embeds a local image path:

```json
{
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "![Draft ChatInput CardFrame](/tmp/draft-cardframe-key.png)"
    }
  ]
}
```

Another observed example is:

```md
![模型错误卡片模拟效果](/tmp/model-error-card-preview.png)
```

A bare path mention is not an image request:

```md
截图文件是 `/tmp/model-error-card-preview.png`。
```

Only a Markdown `img` node triggers image resolution.

## Current Failure

`Response` delegates assistant text to Streamdown. Streamdown creates an `<img>` for Markdown image syntax, but a local absolute path is resolved against the renderer origin.

Browser and Electron development:

```text
/tmp/result.png
→ http://localhost:<vite-port>/tmp/result.png
```

Packaged Electron:

```text
/tmp/result.png
→ pie://app/tmp/result.png
```

Neither URL identifies the environment-host file. `pie://app` currently serves renderer assets and SPA routes; an unknown path may reach the SPA fallback instead of returning image bytes.

## Reference: T3Code

T3Code fixed the same Markdown problem in [`pingdotgg/t3code#6433`](https://github.com/pingdotgg/t3code/pull/6433), commit `77c9d1eb5`.

Its implementation does not load workspace images through `t3code://app`. The custom protocol is the Desktop renderer origin. Markdown filesystem paths are classified in the client, exchanged for signed HTTP asset URLs, and rendered by `<img>`.

Relevant upstream files:

- `packages/client-runtime/src/markdownImages.ts`
- `apps/web/src/components/ChatMarkdown.tsx`
- `apps/web/src/assets/assetUrls.ts`
- `apps/server/src/ws.ts`
- `apps/server/src/assets/AssetAccess.ts`
- `apps/server/src/http.ts`

T3Code resolves the effective checkout root from thread identity, canonicalizes the target, rejects path and symlink escape, validates the preview type, and issues an expiring exact-file capability. Pie adopts the same transport boundary while using `SessionRef`, Pi's stored `cwd`, and a server-owned immutable asset cache.

## Decision

Use short-lived signed HTTP asset URLs for assistant Markdown local images.

Keep `pie://app` responsible for:

- packaged renderer assets;
- the renderer document origin;
- SPA fallback routes.

Do not make `pie://app` a local-file protocol. Do not pass raw `file://` or absolute paths to `<img>`.

Keep data URLs for structured tool-result images, but adapt them at the Pi-to-AI-SDK boundary rather than parsing Pi output in React. The two forms coexist:

```text
structured Pi tool image
  → Pi ImageContent
  → AI SDK FileUIPart
  → data:image/<type>;base64,...

assistant Markdown local image
  → signed HTTP asset URL backed by immutable cached bytes
```

## Architecture

### End-to-end flow

```text
Pi assistant text
  │
  │  ![result](/tmp/result.png)
  ▼
server observes completed assistant text
  ▼
session-scoped image-reference registry
  │  key: complete SessionRef + normalized Markdown destination
  ▼
AssistantMessage
  ▼
Response / Streamdown
  ▼
chat-specific Markdown img renderer
  ▼
classify image source
  ├─ direct URL ───────────────► normal approved <img>
  ├─ local file path ──────────► assets.createUrl(SessionRef, destination)
  └─ blocked source ───────────► unavailable fallback
                                      │
                                      ▼
                              server asset service
                                      │
                                      ├─ require registered reference
                                      ├─ resolve stored session cwd
                                      ├─ validate allowed root
                                      ├─ open/read with no-follow protection
                                      ├─ validate raster bytes and size
                                      └─ cache immutable bytes with TTL
                                      │
                                      ▼
                       /api/assets/<capability>/<filename>
                                      │
                                      ▼
                              browser / Electron <img>
```

### Why a server-side reference registry exists

The renderer must not gain a generic "read any image path" RPC. A compromised renderer holding a valid app connection must not be able to probe arbitrary Project or temporary files by inventing paths.

The server therefore records local image destinations that actually appeared in completed assistant Markdown for a specific `SessionRef`. URL creation succeeds only when the requested destination is registered for that same complete ref.

Registry population:

- Live: register destinations before publishing any event or state that lets the client observe the completed Markdown destination. Registration and publication have a strict happens-before ordering; URL creation must not race registration.
- History: scan normalized assistant text parts and complete registration before returning the messages to the client.
- Restart: rebuild a ref's registrations from authoritative Pi history before serving its history response. If `assets.createUrl` arrives first, it performs the same one-time rehydration before checking authorization. The registry tracks a per-ref hydrated state so concurrent requests share one rebuild.
- Cleanup: remove entries and hydration state when the session is deleted.

The registry stores authorization evidence, not image bytes. It is keyed by complete `SessionRef`, never by bare `sessionId`. A URL-creation request is never rejected merely because post-restart rehydration has not run yet; it waits for that ref's rebuild and then applies the normal authorization check.

A model can still intentionally emit a path that Pi itself can access. That is within the existing agent trust boundary. The registry prevents the renderer from expanding that authority independently or borrowing a path registered by another session.

### Client source classification

The classifier produces one of:

```ts
type ChatImageSource =
  | { type: "direct"; url: string }
  | { type: "session-file"; destination: string }
  | { type: "blocked" };
```

Direct sources:

- `https:`;
- `http:` when allowed by the existing Markdown security policy;
- `blob:`;
- approved raster `data:image/...` sources.

Session-file sources when a complete `SessionRef` exists:

- relative paths;
- POSIX absolute paths;
- Windows drive-absolute paths;
- UNC paths supported by the server platform;
- `file://` URLs.

The client does not resolve relative paths against a caller-supplied cwd. It passes the original normalized destination; the server resolves it against authoritative stored session metadata.

Blocked sources:

- empty destinations;
- malformed `file://` URLs;
- unsupported schemes;
- home-relative `~/...` destinations;
- non-image data URLs;
- local paths when no complete `SessionRef` is available.

The classifier parses a Markdown image destination only. It never scans arbitrary assistant prose for filename suffixes.

### SessionRef propagation

The current transcript path drops the Project half of session identity before reaching `AssistantMessage`. The implementation must propagate the complete `SessionRef` through the existing chat composition:

```text
Chat(sessionRef)
  → ChatSessionProvider
  → ChatSessionContext
  → ChatTranscript
  → MessageView
  → AssistantMessage
  → chat Markdown image renderer
```

`ChatSessionContext` exposes the complete ref. The image query key and URL-creation request use that complete ref. No component reconstructs a ref from message metadata or caches by bare `sessionId`.

### Chat-specific image renderer

`packages/ui` keeps `Response` generic. `AssistantMessage` supplies an app-owned `img` override with access to the complete `SessionRef`.

The renderer has three states:

```text
loading  → fixed, non-animated placeholder
success  → responsive raster image
failure  → accessible "Image unavailable" fallback
```

A successful image uses the signed URL returned by the server. It does not use the original local destination as `src`.

The query key is `{ SessionRef, destination }`. Query freshness is expiration-aware rather than inheriting the app-wide `staleTime: Infinity`: a URL is stale before `expiresAt` by a clock-skew margin and is reminted when stale.

During streaming, local image URL creation is delayed until the Markdown image destination is syntactically complete and stable for a short debounce window, or until the text part reaches its done state. Changing partial destinations must cancel or supersede earlier work instead of minting one URL per text delta.

An `<img>` load failure invalidates the current URL query and permits one immediate remint attempt for that rendered destination. This recovers from server restart, capability expiry, or cache eviction while preventing an infinite retry loop. A failed remint or second load failure renders the unavailable fallback.

### Contract

Introduce an asset URL contract addressed by complete `SessionRef`:

```ts
type SessionImageAsset = {
  type: "session-image";
  ref: SessionRef;
  destination: string;
};

type AssetCreateUrlResult = {
  relativeUrl: string;
  expiresAt: number;
};
```

The client never supplies a Project path or session cwd. The server resolves those from `SessionRef` and stored session metadata.

The server returns a relative route because it does not own the renderer's HTTP origin. The app resolves `relativeUrl` against an explicit asset base URL:

- Desktop: `ServerConnection.httpBaseUrl` supplied at `AppInterface` composition.
- Browser: the configured server origin, normally `window.location.origin`.

The asset base URL is provided through an app-owned context or client service. It is not added to `Platform`, because it is a server connection property shared by browser and Desktop hosts.

### Server asset service

A server asset module owns:

- session image-reference authorization;
- source-path resolution and validation;
- raster MIME detection;
- the bounded immutable asset cache;
- per-process capability signing;
- capability verification;
- asset HTTP responses.

The signing key is generated once per server process and is not persisted. A server restart invalidates old asset URLs; expiration-aware client queries remint them. Both URL creation and HTTP verification receive the same service instance through Layer composition.

The module uses a bounded cache with:

- a finite per-asset limit;
- a finite total byte limit;
- TTL eviction;
- immutable byte entries;
- optional content-hash deduplication only after the current source has been securely reopened and fully read.

Every `assets.createUrl` execution that is not satisfied by the client query rereads current source bytes. The server never shortcuts a remint by path, inode, mtime, or a previous capability. After reading, identical bytes may share an immutable cache entry by content hash.

The cache entry contains the bytes that the HTTP route will return. The GET route never reopens the original local path, eliminating post-signing path replacement and symlink races.

## Path and File Policy

### Allowed roots

A registered session image may resolve under:

1. the session's stored cwd;
2. explicitly supported canonical temporary roots needed for Pi-generated screenshots;
3. a future Pie-owned media directory under `PIE_HOME`.

Temporary roots are an explicit platform policy, not "any directory named tmp". `os.tmpdir()` is intentionally authoritative process configuration: the server snapshots and canonicalizes it once at startup, after environment setup, and all asset-service instances use that same snapshot.

- macOS: canonical `os.tmpdir()` and canonical `/private/tmp`; `/tmp` is accepted only through canonical resolution to `/private/tmp`.
- Linux: canonical `os.tmpdir()` only; `/tmp` is accepted when it resolves to that root. `/var/tmp` is not implicitly allowed.
- Windows: canonical `os.tmpdir()` only, using case-insensitive drive comparison and Windows path semantics. A UNC path is allowed only when it is beneath the stored session cwd; no arbitrary UNC temporary root exists.

Startup resolves and deduplicates these roots. A missing optional root is omitted rather than replaced by a broader parent.

Registration is session-scoped, so a path appearing in one session cannot be minted by another session. A cross-session test is required.

### Source read

Before inserting bytes into the cache:

1. Resolve the complete `SessionRef`.
2. Confirm the destination is registered for that ref.
3. Resolve stored session cwd.
4. Normalize the destination for the host platform.
5. Resolve relative destinations against stored cwd.
6. Open the canonical allowed root as a directory handle.
7. Walk every relative path component from that handle without following links or reparse points.
8. Open the final component from its verified parent handle with the same no-follow rule.
9. Confirm from the open descriptor that it is a regular file.
10. Read bytes from that descriptor.
11. Enforce the size limit while reading.
12. Detect MIME from bytes and reject unsupported formats.
13. Hash the immutable bytes and insert them into the bounded cache.

Validation and reading must use the same descriptor-relative containment operation. A final-component `O_NOFOLLOW` check after string-based parent validation is insufficient because an ancestor directory can be replaced concurrently.

The implementation provides a small secure-open platform adapter:

- Linux uses `openat2` with beneath/no-symlink resolution, or an equivalent descriptor-relative walk.
- macOS uses descriptor-relative `openat` traversal with no-follow checks for every component.
- Windows opens relative to verified directory handles and rejects reparse points for every component before reading.

The adapter fails closed on a platform where it cannot establish this guarantee. It returns an open read handle; the asset service never reopens the path by name.

### Capability

A signed claim references an immutable cache entry, not a local path:

```ts
type SessionImageClaims = {
  version: 1;
  kind: "session-image";
  assetId: string;
  contentHash: string;
  mediaType: RasterImageMediaType;
  expiresAt: number;
};
```

The URL filename is presentation-only and ignored for authorization. Changing it cannot select a sibling file.

The route verifies signature, expiry, cache entry identity, hash, and media type. A missing cache entry returns `404` even if the token is otherwise valid.

## Image Policy

Allowed formats:

```text
image/png
image/jpeg
image/gif
image/webp
image/bmp
```

SVG is excluded because assistant and tool content is untrusted and SVG is an active vector format.

The server determines MIME from file bytes. Extension and URL filename are hints only.

The implementation uses one shared size constant. `20 MiB` is the proposed per-image limit; the implementation task must confirm it and test the exact boundary. The cache also has an explicit total-byte ceiling so repeated images cannot grow server memory without bound.

Responses include:

```http
Cache-Control: private, no-store
Content-Type: <validated raster MIME>
X-Content-Type-Options: nosniff
```

`no-store` prevents a browser from serving an old capability response after a server restart and avoids retaining sensitive local-image bytes in the browser HTTP cache. The server-side immutable cache remains the only cache for capability lifetime.

## Authentication, Routing, and Logging

A native `<img>` request cannot attach the app's ordinary bearer header. The asset capability therefore authenticates the GET itself.

Request policy order:

```text
1. loopback Host / DNS-rebinding check
2. Origin and CORS policy
3. unauthenticated health route
4. exact GET /api/assets/<capability>/<filename> branch
5. bearer authentication for every other /api route and method
6. ordinary API/UI routing
```

The exemption applies only to `GET` under the exact asset route. `POST`, sibling paths, and malformed asset paths remain bearer-protected or return the normal refusal.

Asset failures return `404`, not `401`, after Host and Origin checks. The response does not distinguish malformed, tampered, expired, evicted, or missing capabilities.

The existing refusal logger records request pathnames. Asset requests must be redacted before logging:

```text
/api/assets/<redacted>
```

Neither capability tokens, presentation filenames, nor canonical local paths may appear in routine logs. Logging tests assert the redaction.

## Desktop Behavior

### Content Security Policy

Packaged Desktop currently allows only `img-src 'self' data:`. The implementation must add the narrow loopback source used by signed assets:

```text
img-src 'self' data: http://127.0.0.1:*;
```

It must not add a wildcard network image source. The server connection remains pinned to loopback.

### Packaged Electron

The document origin remains:

```text
pie://app
```

The final image source is resolved against `ServerConnection.httpBaseUrl`:

```text
http://127.0.0.1:<port>/api/assets/<capability>/result.png
```

No request is made to:

```text
pie://app/tmp/result.png
```

### Electron development

The renderer document is served by Vite, but the same signed asset flow applies. The image URL is resolved against the local server base URL, not the Vite origin.

### Browser mode

Browser mode uses the same contract and HTTP route. No Desktop-only bridge or protocol branch is required.

## Persistence

The bounded asset cache is process-local and temporary.

Within a capability's lifetime, the returned bytes remain stable even if the original file is removed or replaced after URL creation. Browser responses use `no-store`, so an old URL is not satisfied from the browser cache after server restart.

After server restart, capability expiry, or cache eviction, the first image GET returns `404`. The component invalidates the URL query and attempts one remint. Before authorizing that remint, the server completes any required registry rehydration for the ref. Reminting always securely reopens and reads current source state; it never returns a prior path-keyed cache entry. It fails if the source file no longer exists.

Durable historical media under `PIE_HOME` is a later capability. The first implementation does not claim that deleted `/tmp` screenshots survive server restarts.

## Failure Behavior

| Failure                                    | User-visible behavior      | Server behavior          |
| ------------------------------------------ | -------------------------- | ------------------------ |
| Source is still being resolved             | Static loading placeholder | No asset GET yet         |
| Unsupported Markdown source                | Image unavailable fallback | No request               |
| Destination was not registered for the ref | Image unavailable fallback | Typed create-URL failure |
| Session no longer exists                   | Image unavailable fallback | Typed create-URL failure |
| Path outside allowed roots                 | Image unavailable fallback | Typed create-URL failure |
| Missing, invalid, or too-large file        | Image unavailable fallback | Typed create-URL failure |
| Expired/tampered/evicted capability        | Image unavailable fallback | 404                      |
| Unsupported MIME/SVG                       | Image unavailable fallback | Typed create-URL failure |

Assistant text remains visible when image resolution fails.

## Compatibility

The change must preserve:

- structured tool-result raster images represented as AI SDK file parts;
- generic JSON rendering for adapted non-image tool output;
- remote Markdown links and images allowed by the existing sanitizer;
- copy-as-Markdown behavior using original assistant text;
- live/history message identity and segmentation;
- `pie://app` renderer asset and SPA behavior.

No Pi JSONL rewrite or migration is required.

## Verification

End-to-end runtime verification is the acceptance gate. Unit and component tests support diagnosis and security boundaries, but cannot substitute for opening a real transcript and decoding a real image.

The implementation must not add tests merely for coverage, framework behavior, snapshots, private helper structure, or assertions already proven by an end-to-end scenario. Prefer extending an existing test over creating a new test file. Add focused automated tests only when they protect a security invariant, a live/history adapter contract, or a failure mode that is impractical to reproduce reliably through the runtime UI.

Required end-to-end evidence uses the normal server, RPC, history, Markdown, HTTP asset, browser, and Electron paths. It must not mock URL creation, replace `<img>` loading with a stub, inject a prebuilt signed URL, or stop after asserting that an `<img>` exists. Success requires browser-decoded dimensions:

```js
image.complete === true && image.naturalWidth > 0 && image.naturalHeight > 0;
```

### Focused classifier tests

Cover:

- relative POSIX destination with a complete `SessionRef`;
- absolute POSIX path;
- `/tmp` canonicalization to `/private/tmp` on macOS;
- Windows drive path;
- UNC path;
- `file://` URL;
- percent-encoded path;
- `https:`, approved data URL, and blob URL;
- malformed and unsupported schemes;
- local path without a complete ref;
- bare path prose remaining ordinary text.

### Reference-registry tests

Cover:

- live completed assistant text registers Markdown image destinations before publication;
- historical assistant text rehydrates registrations before message return;
- a post-restart `createUrl` request rehydrates the ref before authorization;
- concurrent post-restart requests share one rehydration;
- incomplete streaming Markdown does not register;
- code spans and ordinary prose do not register;
- registration is keyed by complete `SessionRef`;
- session A cannot mint a destination registered only by session B.

### Server asset tests

Create real raster files and verify:

- stored-cwd image succeeds;
- registered temporary-root image succeeds;
- unregistered temporary image fails;
- correct MIME and exact bytes are returned;
- responses use `Cache-Control: private, no-store`;
- token mutation returns 404;
- expiry returns 404;
- cache eviction returns 404;
- remint after source replacement returns newly read bytes, not a stale path-deduplicated entry;
- identical reread bytes may deduplicate by content hash;
- traversal and out-of-root paths fail;
- concurrent ancestor-directory replacement cannot escape the root;
- symlink/reparse-point escape at every component and the final component fails;
- non-file targets fail;
- extension/MIME mismatch fails;
- SVG fails;
- exact size-limit boundary succeeds and one byte over fails;
- cache total-byte ceiling evicts or rejects according to the documented policy;
- changing the URL filename cannot select another file;
- replacing or deleting the source after minting does not change already-cached bytes;
- server restart invalidates the old capability and a remint uses current source state.

### HTTP policy tests

Verify:

- valid asset GET without `Authorization` succeeds;
- tampered and expired asset GET return 404 rather than 401;
- invalid Host is rejected before asset handling;
- invalid Origin does not receive permissive CORS headers;
- POST to the asset path does not receive the GET exemption;
- nearby `/api` paths still require bearer authentication;
- refusal logs contain `/api/assets/<redacted>` and contain no token, filename, or local path.

### Focused app regression tests

Do not reproduce the complete runtime flow with mocks. Add only the smallest tests needed to pin behavior that the end-to-end run cannot diagnose precisely:

- the raw local destination is never assigned directly to `<img src>`;
- URL expiry or one load failure causes at most one remint, not a request loop;
- a bare code-formatted path does not invoke image resolution;
- existing Pi `ImageContent` → AI SDK `FileUIPart` live/history tests remain green.

Loading visuals, final image decoding, configured server-base resolution, CSP, and failure fallback are accepted through runtime integration rather than duplicate component fixtures.

### Required historical JSONL end-to-end run

Use an isolated `PIE_HOME` and a real Pi JSONL session containing an assistant text block with local Markdown image syntax. Create a real raster file at the referenced path, launch the normal server and app, load the session through the normal history/RPC path, and open the transcript. Do not seed the client with constructed `UIMessage` objects.

Browser assertions:

```js
{
  src: image.currentSrc,
  complete: image.complete,
  naturalWidth: image.naturalWidth,
  naturalHeight: image.naturalHeight,
}
```

Pass criteria:

```text
src uses the signed asset route
complete is true
naturalWidth > 0
naturalHeight > 0
```

Capture a screenshot of the rendered transcript.

### Required live-stream end-to-end run

Run a real Pi session whose assistant message ends with a local Markdown image. Verify that:

- partial Markdown does not crash the transcript;
- incomplete destinations are not registered or minted;
- the completed destination is registered once;
- the image decodes after final text arrives;
- refreshing reproduces the same result through history.

### Required Desktop end-to-end run

Verify both Electron development and a packaged application through their normal launch paths.

For each mode, assert:

```js
{
  origin: location.origin,
  src: image.currentSrc,
  loaded: image.complete && image.naturalWidth > 0,
}
```

Packaged pass criteria:

- `origin === "pie://app"`;
- `src` uses `ServerConnection.httpBaseUrl` and the signed asset route;
- no request targets `pie://app/tmp/...`;
- the image decodes successfully;
- CSP allows only the expected loopback image source;
- CORS and bearer routing do not block the signed GET.

### Repository checks

Run the affected server, app, and Desktop tests through Turbo, then run:

```text
pnpm check
pnpm test
React Doctor on changed React files
git diff --check
```

## Delivery Criteria

The capability is complete only when all of the following are demonstrated:

1. Structured Pi tool-result images still render.
2. Assistant Markdown images under the stored session cwd render.
3. Registered assistant Markdown images under supported temporary roots render.
4. Bare path mentions do not render as images.
5. The renderer cannot mint an unregistered or cross-session path.
6. Invalid paths, symlink escapes, and unsupported formats cannot be read.
7. Browser, Electron development, and packaged `pie://app` decode a real image.
8. Live and historical messages behave consistently.
9. The final report includes test output, decoded image dimensions, final image URL shape, and runtime screenshots.
