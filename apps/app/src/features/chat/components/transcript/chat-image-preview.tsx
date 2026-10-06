import { useMediaQuery } from "@getpie/ui/hooks/use-media-query";
import { cn } from "@getpie/ui/lib/utils";
import type { ComponentProps } from "react";
import Zoom from "react-medium-image-zoom";

const imageClassName =
  "h-auto w-auto max-h-[30rem] max-w-[min(100%,30rem)] rounded-lg border border-border/40 object-contain";

export type ChatImagePreviewProps = Omit<ComponentProps<"img">, "src"> & { src: string };

export function ChatImagePreview({ alt, className, src, ...props }: ChatImagePreviewProps) {
  // Below sm the thumbnail runs at 100% of the column, so the zoom margin must
  // stay under the column padding or the "zoomed" image renders smaller than
  // the thumbnail. From sm the 30rem cap leaves room for breathing space.
  const wide = useMediaQuery("sm");
  return (
    <Zoom classDialog="chat-image-preview-dialog" wrapElement="span" zoomMargin={wide ? 80 : 12}>
      <img alt={alt ?? ""} className={cn(imageClassName, className)} src={src} {...props} />
    </Zoom>
  );
}
