import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useRef, useState, type ComponentProps } from "react";

import { useEnvironmentOrpc } from "@/lib/environment-orpc";

import { useChatSession } from "../chat-session-context";
import { classifyMarkdownImageSource, type MarkdownImageSource } from "./chat-markdown";

type MarkdownImageProps = ComponentProps<"img"> & { node?: unknown };

const ASSET_STALE_TIME_MS = 4 * 60 * 1000;
const imageClassName = "h-auto w-auto max-h-[32rem] max-w-full rounded-md object-contain";

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
        height={1024}
        src={source.url}
        width={1024}
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
  const orpc = useEnvironmentOrpc();
  const { environmentRpc } = useRouteContext({ from: "__root__" });
  const httpBaseUrl = environmentRpc.httpBaseUrl(sessionRef.environmentId);
  const retriedRef = useRef(false);
  const [recovering, setRecovering] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const imageUrl = useQuery({
    ...orpc.assets.createUrl.queryOptions({
      input: { ref: sessionRef.ref, destination: source.destination },
    }),
    enabled: !turnInProgress,
    staleTime: ASSET_STALE_TIME_MS,
    meta: { errorMode: "inline" },
  });

  if ((turnInProgress && imageUrl.data === undefined) || imageUrl.isPending || recovering) {
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

  const recoverExpiredUrl = async (): Promise<void> => {
    setRecovering(true);
    try {
      const result = await imageUrl.refetch();
      if (result.isError) setUnavailable(true);
    } finally {
      setRecovering(false);
    }
  };

  return (
    <img
      {...props}
      alt={alt ?? ""}
      className={`${imageClassName} ${className ?? ""}`}
      height={1024}
      src={resolved}
      width={1024}
      onError={() => {
        if (retriedRef.current) {
          setUnavailable(true);
          return;
        }
        retriedRef.current = true;
        void recoverExpiredUrl();
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
