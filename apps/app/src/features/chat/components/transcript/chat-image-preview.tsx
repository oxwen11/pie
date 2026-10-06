import { cn } from "@getpie/ui/lib/utils";
import type { ComponentProps } from "react";
import Zoom from "react-medium-image-zoom";

const imageClassName =
  "h-auto w-auto max-h-[30rem] max-w-[min(100%,30rem)] rounded-lg border border-border/40 object-contain";

export type ChatImagePreviewProps = Omit<ComponentProps<"img">, "src"> & { src: string };

export function ChatImagePreview({ alt, className, src, ...props }: ChatImagePreviewProps) {
  return (
    <Zoom classDialog="chat-image-preview-dialog" wrapElement="span" zoomMargin={80}>
      <img alt={alt ?? ""} className={cn(imageClassName, className)} src={src} {...props} />
    </Zoom>
  );
}
