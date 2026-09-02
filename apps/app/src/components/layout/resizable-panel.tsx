import type { ComponentProps, CSSProperties, ReactElement } from "react";
import { Panel } from "react-resizable-panels";

const CLIPPED_CONTENT_STYLE = { overflow: "hidden" } satisfies CSSProperties;

export type ResizablePanelProps = ComponentProps<typeof Panel>;

/**
 * App layout adapter for react-resizable-panels v4.
 *
 * The library renders an outer sizing element and applies `className` / `style`
 * to an inner wrapper with inline `overflow:auto`. App layouts own their nested
 * scrollers, so this adapter enforces clipping on that wrapper. A deliberate
 * responsive exception must use an important CSS utility.
 */
export function ResizablePanel({ style, ...props }: ResizablePanelProps): ReactElement {
  return <Panel {...props} style={{ ...style, ...CLIPPED_CONTENT_STYLE }} />;
}
