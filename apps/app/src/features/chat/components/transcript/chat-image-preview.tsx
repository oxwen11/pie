import { useMediaQuery } from "@getpie/ui/hooks/use-media-query";
import { cn } from "@getpie/ui/lib/utils";
import { useState, type ComponentProps } from "react";
import Zoom from "react-medium-image-zoom";

const imageClassName =
  "h-auto w-auto max-h-[30rem] max-w-[min(100%,30rem)] rounded-lg border border-border/40 object-contain";

export type ChatImagePreviewProps = Omit<ComponentProps<"img">, "src"> & { src: string };

export function ChatImagePreview({ alt, className, src, ...props }: ChatImagePreviewProps) {
  // Below sm the thumbnail runs at 100% of the column, so the zoom margin must
  // stay under the column padding or the "zoomed" image renders smaller than
  // the thumbnail. From sm the 30rem cap leaves room for breathing space.
  const wide = useMediaQuery("sm");
  // rmiz must not see zoomMargin change while the dialog is open, so the
  // value is captured per open and the sm query can never flip it mid-dialog.
  const [zoomMargin, setZoomMargin] = useState(() => (wide ? 80 : 12));
  return (
    <Zoom
      classDialog="chat-image-preview-dialog"
      wrapElement="span"
      zoomMargin={zoomMargin}
      onZoomChange={(zoomed) => {
        if (zoomed) setZoomMargin(wide ? 80 : 12);
      }}
    >
      <img alt={alt ?? ""} className={cn(imageClassName, className)} src={src} {...props} />
    </Zoom>
  );
}
