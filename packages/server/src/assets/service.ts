import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import url from "node:url";

import type { SessionRef } from "@getpie/contract";
import { Context, Data, Effect, Layer } from "effect";
import { fromMarkdown } from "mdast-util-from-markdown";

import { SessionNotFound } from "../errors";
import { PiAgentSessionService } from "../harness";

const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_CACHE_BYTES = 128 * 1024 * 1024;
const ASSET_TTL_MS = 5 * 60 * 1000;

export class AssetNotReferenced extends Data.TaggedError("AssetNotReferenced")<{
  readonly destination: string;
}> {}
export class AssetNotFound extends Data.TaggedError("AssetNotFound")<{
  readonly destination: string;
}> {}
export class AssetPathNotAllowed extends Data.TaggedError("AssetPathNotAllowed")<{
  readonly destination: string;
}> {}
export class AssetNotImage extends Data.TaggedError("AssetNotImage")<{
  readonly destination: string;
}> {}
export class AssetFileTooLarge extends Data.TaggedError("AssetFileTooLarge")<{
  readonly destination: string;
  readonly size: number;
  readonly limit: number;
}> {}
export class AssetReadFailed extends Data.TaggedError("AssetReadFailed")<{
  readonly destination: string;
  readonly cause?: unknown;
}> {}

export type AssetCreateError =
  | SessionNotFound
  | AssetNotReferenced
  | AssetNotFound
  | AssetPathNotAllowed
  | AssetNotImage
  | AssetFileTooLarge
  | AssetReadFailed;

type SessionImageClaims = {
  readonly version: 1;
  readonly assetId: string;
  readonly contentHash: string;
  readonly expiresAt: number;
};

type CachedAsset = {
  readonly bytes: Uint8Array;
  readonly contentHash: string;
  readonly expiresAt: number;
  readonly mediaType: string;
};

export type AssetHttpContent = {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
};

const contains = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  const comparable = process.platform === "win32" ? relative.toLowerCase() : relative;
  return (
    comparable === "" ||
    (!path.isAbsolute(comparable) && comparable !== ".." && !comparable.startsWith(`..${path.sep}`))
  );
};

const readMagicMediaType = (bytes: Uint8Array): string | null => {
  const startsWith = (...prefix: number[]) =>
    bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);

  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x47, 0x49, 0x46, 0x38, 0x37, 0x61)) return "image/gif";
  if (startsWith(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)) return "image/gif";
  if (
    bytes.length >= 12 &&
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (startsWith(0x42, 0x4d)) return "image/bmp";
  return null;
};

function collectMarkdownImageDestinations(value: unknown, destinations: Set<string>): void {
  if (typeof value !== "object" || value === null) return;
  const node = value as { type?: unknown; url?: unknown; children?: unknown };
  if (node.type === "image" && typeof node.url === "string") destinations.add(node.url);
  if (Array.isArray(node.children)) {
    for (const child of node.children) collectMarkdownImageDestinations(child, destinations);
  }
}

function destinationIsReferenced(
  messages: ReadonlyArray<{ role: string; parts: ReadonlyArray<unknown> }>,
  destination: string,
): boolean {
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (typeof part !== "object" || part === null) continue;
      const candidate = part as { type?: unknown; text?: unknown };
      if (candidate.type !== "text" || typeof candidate.text !== "string") continue;
      const destinations = new Set<string>();
      collectMarkdownImageDestinations(fromMarkdown(candidate.text), destinations);
      if (destinations.has(destination)) return true;
    }
  }
  return false;
}

function decodeLocalDestination(destination: string): string {
  if (destination.startsWith("file://")) return url.fileURLToPath(destination);
  if (destination.startsWith("~/") || destination.startsWith("~\\")) {
    throw new AssetPathNotAllowed({ destination });
  }
  const windowsAbsolute =
    /^[a-z]:[\\/]/i.test(destination) || destination.startsWith(String.raw`\\`);
  if (windowsAbsolute && process.platform !== "win32") {
    throw new AssetPathNotAllowed({ destination });
  }
  if (!windowsAbsolute && /^[a-z][a-z\d+.-]*:/i.test(destination)) {
    throw new AssetPathNotAllowed({ destination });
  }
  try {
    return decodeURIComponent(destination);
  } catch {
    throw new AssetPathNotAllowed({ destination });
  }
}

function encodeClaims(claims: SessionImageClaims, secret: Buffer): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function decodeClaims(
  token: string,
  secret: Buffer,
): { assetId: string; contentHash: string; expiresAt: number } | null {
  const [payload, presented, extra] = token.split(".");
  if (!payload || !presented || extra !== undefined) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest();
  let signature: Buffer;
  try {
    signature = Buffer.from(presented, "base64url");
  } catch {
    return null;
  }
  if (signature.length !== expected.length || !crypto.timingSafeEqual(signature, expected)) {
    return null;
  }
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      assetId?: unknown;
      contentHash?: unknown;
      expiresAt?: unknown;
      version?: unknown;
    };
    return value.version === 1 &&
      typeof value.assetId === "string" &&
      typeof value.contentHash === "string" &&
      typeof value.expiresAt === "number"
      ? {
          assetId: value.assetId,
          contentHash: value.contentHash,
          expiresAt: value.expiresAt,
        }
      : null;
  } catch {
    return null;
  }
}

export class SessionImageAssets extends Context.Service<
  SessionImageAssets,
  {
    readonly createUrl: (
      ref: SessionRef,
      destination: string,
    ) => Effect.Effect<{ relativeUrl: string; expiresAt: number }, AssetCreateError>;
    readonly contentForToken: (token: string) => Effect.Effect<AssetHttpContent | null>;
  }
>()("SessionImageAssets") {}

export const SessionImageAssetsLayer: Layer.Layer<
  SessionImageAssets,
  never,
  PiAgentSessionService
> = Layer.effect(
  SessionImageAssets,
  Effect.gen(function* () {
    const sessions = yield* PiAgentSessionService;
    const secret = crypto.randomBytes(32);
    const temporaryRoots = yield* Effect.promise(async () => {
      const roots = new Set<string>([await fsPromises.realpath(os.tmpdir())]);
      if (process.platform === "darwin") {
        try {
          roots.add(await fsPromises.realpath("/private/tmp"));
        } catch {
          // Optional fixed root; os.tmpdir remains authoritative.
        }
      }
      return roots;
    });
    const cache = new Map<string, CachedAsset>();
    let cacheBytes = 0;

    const pruneCache = (now: number): void => {
      for (const [assetId, asset] of cache) {
        if (asset.expiresAt > now) continue;
        cache.delete(assetId);
        cacheBytes -= asset.bytes.byteLength;
      }
      while (cacheBytes > MAX_CACHE_BYTES) {
        const oldest = cache.entries().next().value as [string, CachedAsset] | undefined;
        if (!oldest) break;
        cache.delete(oldest[0]);
        cacheBytes -= oldest[1].bytes.byteLength;
      }
    };

    const createUrl = (ref: SessionRef, destination: string) =>
      Effect.gen(function* () {
        const [workspace, messages] = yield* Effect.all([
          sessions.workspaceFor(ref),
          sessions.getMessages(ref),
        ]).pipe(
          Effect.mapError((error) =>
            error instanceof SessionNotFound
              ? error
              : new AssetReadFailed({ destination, cause: error }),
          ),
        );

        if (!destinationIsReferenced(messages, destination)) {
          return yield* new AssetNotReferenced({ destination });
        }

        const loaded = yield* Effect.tryPromise({
          try: async () => {
            const decoded = decodeLocalDestination(destination);
            const requested = path.isAbsolute(decoded)
              ? path.normalize(decoded)
              : path.resolve(workspace.cwd, decoded);
            const roots = new Set([...temporaryRoots, await fsPromises.realpath(workspace.cwd)]);

            let canonical: string;
            try {
              canonical = await fsPromises.realpath(requested);
            } catch (cause) {
              const code = (cause as NodeJS.ErrnoException).code;
              if (code === "ENOENT") throw new AssetNotFound({ destination });
              throw cause;
            }
            if (![...roots].some((root) => contains(root, canonical))) {
              throw new AssetPathNotAllowed({ destination });
            }

            const beforeOpen = await fsPromises.lstat(canonical);
            const noFollow = fs.constants.O_NOFOLLOW ?? 0;
            const handle = await fsPromises.open(canonical, fs.constants.O_RDONLY | noFollow);
            try {
              const info = await handle.stat();
              const afterOpen = await fsPromises.realpath(requested);
              if (
                !beforeOpen.isFile() ||
                !info.isFile() ||
                beforeOpen.dev !== info.dev ||
                beforeOpen.ino !== info.ino ||
                afterOpen !== canonical ||
                ![...roots].some((root) => contains(root, afterOpen))
              ) {
                throw new AssetPathNotAllowed({ destination });
              }
              if (info.size > MAX_ASSET_BYTES) {
                throw new AssetFileTooLarge({
                  destination,
                  size: info.size,
                  limit: MAX_ASSET_BYTES,
                });
              }

              const chunks: Buffer[] = [];
              let total = 0;
              for (;;) {
                const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_ASSET_BYTES + 1 - total));
                const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
                if (bytesRead === 0) break;
                total += bytesRead;
                if (total > MAX_ASSET_BYTES) {
                  throw new AssetFileTooLarge({
                    destination,
                    size: total,
                    limit: MAX_ASSET_BYTES,
                  });
                }
                chunks.push(chunk.subarray(0, bytesRead));
              }
              const bytes = new Uint8Array(Buffer.concat(chunks, total));
              const mediaType = readMagicMediaType(bytes);
              if (mediaType === null) throw new AssetNotImage({ destination });
              const contentHash = crypto.createHash("sha256").update(bytes).digest("base64url");
              return { bytes, canonical, contentHash, mediaType };
            } finally {
              await handle.close();
            }
          },
          catch: (cause) => {
            if ((cause as NodeJS.ErrnoException).code === "ELOOP") {
              return new AssetPathNotAllowed({ destination });
            }
            if (
              cause instanceof AssetNotFound ||
              cause instanceof AssetPathNotAllowed ||
              cause instanceof AssetNotImage ||
              cause instanceof AssetFileTooLarge
            ) {
              return cause;
            }
            return new AssetReadFailed({ destination, cause });
          },
        });

        const now = Date.now();
        pruneCache(now);
        const assetId = crypto.randomUUID();
        const expiresAt = now + ASSET_TTL_MS;
        cache.set(assetId, {
          bytes: loaded.bytes,
          contentHash: loaded.contentHash,
          expiresAt,
          mediaType: loaded.mediaType,
        });
        cacheBytes += loaded.bytes.byteLength;
        pruneCache(now);

        const token = encodeClaims(
          {
            version: 1,
            assetId,
            contentHash: loaded.contentHash,
            expiresAt,
          },
          secret,
        );
        const filename = encodeURIComponent(path.basename(loaded.canonical) || "image");
        return { relativeUrl: `/api/assets/${token}/${filename}`, expiresAt };
      });

    const contentForToken = (token: string) =>
      Effect.sync(() => {
        const now = Date.now();
        pruneCache(now);
        const claims = decodeClaims(token, secret);
        if (claims === null || claims.expiresAt <= now) return null;
        const asset = cache.get(claims.assetId);
        if (
          asset === undefined ||
          asset.expiresAt !== claims.expiresAt ||
          asset.contentHash !== claims.contentHash
        ) {
          return null;
        }
        return { bytes: asset.bytes, mediaType: asset.mediaType };
      });

    return { createUrl, contentForToken };
  }),
);
