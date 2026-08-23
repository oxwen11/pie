import { cn } from "@getpie/ui/lib/utils";
import type { ReactElement } from "react";

import pieMarkUrl from "@/assets/pie-mark.svg?url";

// Web and desktop win/linux: sidebar header when expanded. Desktop macOS omits
// this — native traffic lights own the row.
export function BrandMark({ className }: { className?: string }): ReactElement {
  return (
    <div className={cn("flex h-7 items-center gap-2 select-none", className)}>
      <span
        aria-hidden="true"
        className="bg-foreground block size-4 shrink-0 [mask-size:contain] [mask-position:center] [mask-repeat:no-repeat] [-webkit-mask-position:center] [-webkit-mask-repeat:no-repeat] [-webkit-mask-size:contain]"
        // Quoted, and not optional: dev serves this as a data URI whose own
        // single quotes are illegal inside a bare `url()`, so the browser drops
        // the whole declaration and the mark renders as a filled square.
        style={{ WebkitMaskImage: `url("${pieMarkUrl}")`, maskImage: `url("${pieMarkUrl}")` }}
      />
      {/* The product name as the desktop build spells it (electron-builder's
          `productName`), not the lowercase package id. */}
      <span className="text-sm font-medium tracking-tight">Pie</span>
    </div>
  );
}
