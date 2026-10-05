import type { ReactElement, ReactNode } from "react";

import type { TextRange } from "./skill-search";

export function HighlightedMatch(props: {
  text: string;
  ranges?: readonly TextRange[];
}): ReactElement | string {
  const ranges = props.ranges;
  if (!ranges || ranges.length === 0) return props.text;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      nodes.push(
        <span className="text-muted-foreground" key={`gap-${cursor}`}>
          {props.text.slice(cursor, range.start)}
        </span>,
      );
    }
    nodes.push(
      <mark key={range.start} className="text-foreground bg-transparent font-semibold">
        {props.text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  }
  if (cursor < props.text.length) {
    nodes.push(
      <span className="text-muted-foreground" key={`gap-${cursor}`}>
        {props.text.slice(cursor)}
      </span>,
    );
  }
  return <span>{nodes}</span>;
}
