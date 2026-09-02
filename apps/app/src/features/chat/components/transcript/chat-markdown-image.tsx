import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useState, type ComponentProps } from "react";
import { defaultRemarkPlugins } from "streamdown";

import { useChatSession } from "../chat-session-context";

type MarkdownImageProps = ComponentProps<"img"> & { node?: unknown };

type MarkdownImageSource =
  | { type: "direct"; url: string }
  | { type: "session-file"; destination: string }
  | { type: "blocked" };

const RASTER_DATA_URL = /^data:image\/(?:bmp|gif|jpeg|png|webp);base64,/i;
const EXPLICIT_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const ASSET_STALE_TIME_MS = 4 * 60 * 1000;
const LOCAL_IMAGE_PREFIX = "https://pie-local.invalid/";

function isLocalMarkdownDestination(url: string): boolean {
  if (/^[a-z]:[\\/]/i.test(url) || url.startsWith(String.raw`\\`)) return true;
  if (/^(?:https?:|blob:)/i.test(url) || RASTER_DATA_URL.test(url)) return false;
  if (url.startsWith("~/") || url.startsWith("~\\") || url.startsWith("//")) return false;
  return /^file:/i.test(url) || !EXPLICIT_SCHEME.test(url);
}

function rewriteLocalMarkdownImages(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  const node = value as { type?: unknown; url?: unknown; children?: unknown };
  if (
    node.type === "image" &&
    typeof node.url === "string" &&
    isLocalMarkdownDestination(node.url)
  ) {
    node.url = `${LOCAL_IMAGE_PREFIX}${encodeURIComponent(node.url)}`;
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) rewriteLocalMarkdownImages(child);
  }
}

const localImageRemarkPlugin = () => (tree: unknown) => rewriteLocalMarkdownImages(tree);

export const CHAT_MARKDOWN_REMARK_PLUGINS = [
  ...Object.values(defaultRemarkPlugins),
  localImageRemarkPlugin,
];

export function classifyMarkdownImageSource(src: string | undefined): MarkdownImageSource {
  if (!src) return { type: "blocked" };
  if (src.startsWith(LOCAL_IMAGE_PREFIX)) {
    try {
      return {
        type: "session-file",
        destination: decodeURIComponent(src.slice(LOCAL_IMAGE_PREFIX.length)),
      };
    } catch {
      return { type: "blocked" };
    }
  }
  if (/^[a-z]:[\\/]/i.test(src) || src.startsWith(String.raw`\\`)) {
    return { type: "session-file", destination: src };
  }
  if (/^(?:https?:|blob:)/i.test(src) || RASTER_DATA_URL.test(src)) {
    return { type: "direct", url: src };
  }
  if (src.startsWith("~/") || src.startsWith("~\\") || src.startsWith("//")) {
    return { type: "blocked" };
  }
  if (/^file:/i.test(src)) return { type: "session-file", destination: src };
  if (EXPLICIT_SCHEME.test(src)) return { type: "blocked" };
  return { type: "session-file", destination: src };
}

const imageClassName = "max-h-[32rem] max-w-full rounded-md object-contain";

export function ChatMarkdownImage({
  alt,
  className,
  node: _node,
  src,
  ...props
}: MarkdownImageProps) {
  const source = classifyMarkdownImageSource(src);
  if (source.type === "direct") {
    return (
      <img
        {...props}
        alt={alt ?? ""}
        className={`${imageClassName} ${className ?? ""}`}
        src={source.url}
      />
    );
  }
  if (source.type === "blocked") return <ImageUnavailable alt={alt} />;
  return (
    <SessionMarkdownImage
      {...props}
      key={source.destination}
      alt={alt}
      className={className}
      source={source}
    />
  );
}

function SessionMarkdownImage({
  alt,
  className,
  source,
  ...props
}: Omit<MarkdownImageProps, "node" | "src"> & {
  source: Extract<MarkdownImageSource, { type: "session-file" }>;
}) {
  const { sessionRef, turnInProgress } = useChatSession();
  const { httpBaseUrl, orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const [retried, setRetried] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const imageUrl = useQuery({
    ...orpcQueryUtils.assets.createUrl.queryOptions({
      input: { ref: sessionRef, destination: source.destination },
    }),
    enabled: !turnInProgress,
    staleTime: ASSET_STALE_TIME_MS,
    meta: { errorMode: "inline" },
  });

  if (turnInProgress || imageUrl.isPending || recovering) {
    return (
      <span aria-label={alt ?? "Image"} className="text-muted-foreground text-xs" role="img">
        Loading image…
      </span>
    );
  }
  if (imageUrl.isError || imageUrl.data === undefined || unavailable) {
    return <ImageUnavailable alt={alt} />;
  }

  const resolved = new URL(imageUrl.data.relativeUrl, httpBaseUrl).href;
  return (
    <img
      {...props}
      alt={alt ?? ""}
      className={`${imageClassName} ${className ?? ""}`}
      src={resolved}
      onError={() => {
        if (retried) {
          setUnavailable(true);
          return;
        }
        setRetried(true);
        setRecovering(true);
        void imageUrl
          .refetch()
          .then((result) => {
            if (result.isError) setUnavailable(true);
          })
          .finally(() => setRecovering(false));
      }}
    />
  );
}

function ImageUnavailable({ alt }: { alt: string | undefined }) {
  return (
    <span className="text-muted-foreground text-xs" role="img" aria-label={alt ?? "Image"}>
      Image unavailable
    </span>
  );
}

export const CHAT_MARKDOWN_COMPONENTS = { img: ChatMarkdownImage };
