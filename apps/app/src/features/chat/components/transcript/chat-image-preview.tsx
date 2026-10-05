import { Button } from "@getpie/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@getpie/ui/components/dialog";
import { cn } from "@getpie/ui/lib/utils";
import { ExpandIcon, MinusIcon, PlusIcon, XIcon } from "lucide-react";
import { useRef, useState, type ComponentProps } from "react";

const imageClassName = "h-auto w-auto max-h-44 max-w-full rounded-md object-contain sm:max-w-xs";
const controlClassName = "size-11 sm:size-11";

export type ChatImagePreviewProps = Omit<ComponentProps<"img">, "src"> & { src: string };

export function ChatImagePreview({ alt, className, src, ...props }: ChatImagePreviewProps) {
  const label = alt?.trim() ? alt : "Image";
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label={`Expand image: ${label}`}
            className="focus-visible:ring-ring relative inline-flex min-h-11 max-w-full min-w-11 cursor-zoom-in items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          />
        }
      >
        <img alt={alt ?? ""} className={cn(imageClassName, className)} src={src} {...props} />
        <span className="pointer-events-none absolute right-2 bottom-2 flex size-8 items-center justify-center rounded-lg bg-black/60 text-white shadow-sm ring-1 ring-white/15 backdrop-blur-sm">
          <ExpandIcon aria-hidden="true" className="size-4" />
        </span>
      </DialogTrigger>
      <DialogPopup
        bottomStickOnMobile={false}
        showCloseButton={false}
        className="fixed inset-3 m-auto h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-none sm:inset-6 sm:h-[calc(100dvh-3rem)] sm:w-[calc(100vw-3rem)]"
        render={<div className="chat-image-preview motion-reduce:transition-none" />}
      >
        <ImagePreviewContent key={src} alt={label} src={src} onError={props.onError} />
      </DialogPopup>
    </Dialog>
  );
}

function ImagePreviewContent({
  alt,
  src,
  onError,
}: Pick<ChatImagePreviewProps, "src" | "onError"> & { alt: string }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [scale, setScale] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  const zoom = (factor: number) => {
    const image = imageRef.current;
    if (!image || !naturalWidth) return;
    const current = scale ?? image.clientWidth / naturalWidth;
    setScale(Math.min(4, Math.max(Math.min(current, 0.1), current * factor)));
  };

  return (
    <>
      <DialogTitle render={<h2 className="sr-only">{alt}</h2>} />
      <DialogClose
        aria-label="Close image preview"
        className="absolute top-3 right-3 z-10"
        render={<Button className={controlClassName} size="icon" variant="ghost" />}
      >
        <XIcon aria-hidden="true" className="size-5" />
      </DialogClose>
      <div
        aria-label="Image canvas"
        className="bg-muted/30 focus-visible:ring-ring [container-type:size] min-h-0 flex-1 overflow-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset"
        role="region"
      >
        <div className="flex min-h-full w-max min-w-full items-center justify-center px-4 py-16">
          {failed ? (
            <p className="text-muted-foreground text-sm" role="status">
              Image unavailable
            </p>
          ) : (
            <img
              ref={imageRef}
              alt={alt}
              className={cn(
                "block h-auto w-auto rounded-sm shadow-lg",
                scale === null
                  ? "max-h-[calc(100cqh-8rem)] max-w-[calc(100cqw-2rem)]"
                  : "max-w-none",
              )}
              draggable={false}
              src={src}
              style={scale === null ? undefined : { width: naturalWidth * scale }}
              onError={(event) => {
                setFailed(true);
                onError?.(event);
              }}
              onLoad={(event) => setNaturalWidth(event.currentTarget.naturalWidth)}
            />
          )}
        </div>
      </div>
      <ImagePreviewControls disabled={!naturalWidth || failed} scale={scale} onZoom={zoom} />
    </>
  );
}

function ImagePreviewControls({
  disabled,
  scale,
  onZoom,
}: {
  disabled: boolean;
  scale: number | null;
  onZoom: (factor: number) => void;
}) {
  return (
    <div
      aria-label="Image zoom controls"
      className="absolute inset-x-0 bottom-4 flex justify-center gap-2"
      role="group"
    >
      <Button
        aria-label="Zoom out"
        className={controlClassName}
        disabled={disabled || (scale ?? 1) <= 0.1}
        size="icon"
        variant="ghost"
        onClick={() => onZoom(1 / 1.25)}
      >
        <MinusIcon aria-hidden="true" className="size-5" />
      </Button>
      <Button
        aria-label="Zoom in"
        className={controlClassName}
        disabled={disabled || (scale ?? 1) >= 4}
        size="icon"
        variant="ghost"
        onClick={() => onZoom(1.25)}
      >
        <PlusIcon aria-hidden="true" className="size-5" />
      </Button>
    </div>
  );
}
