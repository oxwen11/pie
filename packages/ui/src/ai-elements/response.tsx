"use client";

import { cn } from "@getpie/ui/lib/utils";
import { code } from "@streamdown/code";
import {
  cloneElement,
  type ComponentProps,
  isValidElement,
  type JSX,
  memo,
  type ReactNode,
} from "react";
import { type Components, Streamdown } from "streamdown";

type ResponseProps = ComponentProps<typeof Streamdown> & {
  className?: string;
};

type MarkdownPoint = { line?: number; column?: number };
type MarkdownPosition = { start?: MarkdownPoint; end?: MarkdownPoint };
type MarkdownNode = {
  tagName?: string;
  position?: MarkdownPosition;
  properties?: { className?: string | string[] };
};

type WithNode<T> = T & {
  node?: MarkdownNode;
  children?: ReactNode;
  className?: string;
};

type ElementProps<T> = T & {
  node?: MarkdownNode;
  children?: ReactNode;
};

type ElementWithProps<T> = {
  props: ElementProps<T>;
};

function sameNodePosition(prev?: MarkdownNode, next?: MarkdownNode): boolean {
  if (!(prev?.position || next?.position)) {
    return true;
  }
  if (!(prev?.position && next?.position)) {
    return false;
  }

  const prevStart = prev.position?.start;
  const nextStart = next.position?.start;
  const prevEnd = prev.position?.end;
  const nextEnd = next.position?.end;

  return (
    prevStart?.line === nextStart?.line &&
    prevStart?.column === nextStart?.column &&
    prevEnd?.line === nextEnd?.line &&
    prevEnd?.column === nextEnd?.column
  );
}

function sameClassAndNode(
  prev: { className?: string; node?: MarkdownNode; children?: ReactNode },
  next: { className?: string; node?: MarkdownNode; children?: ReactNode },
) {
  return (
    prev.children === next.children &&
    prev.className === next.className &&
    sameNodePosition(prev.node, next.node)
  );
}

type OlProps = WithNode<JSX.IntrinsicElements["ol"]>;
const MemoOl = memo<OlProps>(
  ({ children, className, node: _node, ...props }: OlProps) => (
    <ol className={cn("ml-4 list-outside list-decimal whitespace-normal", className)} {...props}>
      {children}
    </ol>
  ),
  (p, n) => sameClassAndNode(p, n),
);
MemoOl.displayName = "MarkdownOl";

type LiProps = WithNode<JSX.IntrinsicElements["li"]>;
const MemoLi = memo<LiProps>(
  ({ children, className, node: _node, ...props }: LiProps) => (
    <li className={cn("py-1 text-sm", className)} {...props}>
      {children}
    </li>
  ),
  (p, n) => sameClassAndNode(p, n),
);
MemoLi.displayName = "MarkdownLi";

type UlProps = WithNode<JSX.IntrinsicElements["ul"]>;
const MemoUl = memo<UlProps>(
  ({ children, className, node: _node, ...props }: UlProps) => (
    <ul className={cn("ml-4 list-outside list-disc whitespace-normal", className)} {...props}>
      {children}
    </ul>
  ),
  (p, n) => sameClassAndNode(p, n),
);
MemoUl.displayName = "MarkdownUl";

type HrProps = WithNode<JSX.IntrinsicElements["hr"]>;
const MemoHr = memo<HrProps>(
  ({ className, node: _node, ...props }: HrProps) => (
    <hr className={cn("border-border my-6", className)} {...props} />
  ),
  (p, n) => sameClassAndNode(p, n),
);
MemoHr.displayName = "MarkdownHr";

type StrongProps = WithNode<JSX.IntrinsicElements["span"]>;
const MemoStrong = memo<StrongProps>(
  ({ children, className, node: _node, ...props }: StrongProps) => (
    <span className={cn("font-semibold", className)} {...props}>
      {children}
    </span>
  ),
  (p, n) => sameClassAndNode(p, n),
);
MemoStrong.displayName = "MarkdownStrong";

type AProps = WithNode<JSX.IntrinsicElements["a"]> & { href?: string };
const MemoA = memo<AProps>(
  ({ children, className, href, node: _node, ...props }: AProps) => (
    <a
      className={cn("text-primary text-sm font-medium wrap-anywhere underline", className)}
      href={href}
      rel="noreferrer"
      target="_blank"
      {...props}
    >
      {children}
    </a>
  ),
  (p, n) => sameClassAndNode(p, n) && p.href === n.href,
);
MemoA.displayName = "MarkdownA";

type HeadingProps<TTag extends keyof JSX.IntrinsicElements> = WithNode<JSX.IntrinsicElements[TTag]>;

const MemoH1 = memo<HeadingProps<"h1">>(
  ({ children, className, node: _node, ...props }) => (
    <h1 className={cn("mt-5 mb-1 text-2xl font-semibold", className)} {...props}>
      {children}
    </h1>
  ),
  (p, n) => sameClassAndNode(p, n),
);
MemoH1.displayName = "MarkdownH1";

const MemoH2 = memo<HeadingProps<"h2">>(
  ({ children, className, node: _node, ...props }) => (
    <h2 className={cn("mt-5 mb-1 text-xl font-semibold", className)} {...props}>
      {children}
    </h2>
  ),
  (p, n) => sameClassAndNode(p, n),
);
MemoH2.displayName = "MarkdownH2";

const MemoH3 = memo<HeadingProps<"h3">>(
  ({ children, className, node: _node, ...props }) => (
    <h3 className={cn("mt-4 mb-1 text-lg font-semibold", className)} {...props}>
      {children}
    </h3>
  ),
  (p, n) => sameClassAndNode(p, n),
);
MemoH3.displayName = "MarkdownH3";

const MemoH4 = memo<HeadingProps<"h4">>(
  ({ children, className, node: _node, ...props }) => (
    <h4 className={cn("mt-4 mb-1 text-base font-semibold", className)} {...props}>
      {children}
    </h4>
  ),
  (p, n) => sameClassAndNode(p, n),
);
MemoH4.displayName = "MarkdownH4";

const MemoH5 = memo<HeadingProps<"h5">>(
  ({ children, className, node: _node, ...props }) => (
    <h5 className={cn("mt-3 mb-1 text-sm font-semibold", className)} {...props}>
      {children}
    </h5>
  ),
  (p, n) => sameClassAndNode(p, n),
);
MemoH5.displayName = "MarkdownH5";

const MemoH6 = memo<HeadingProps<"h6">>(
  ({ children, className, node: _node, ...props }) => (
    <h6 className={cn("mt-3 mb-1 text-xs font-semibold", className)} {...props}>
      {children}
    </h6>
  ),
  (p, n) => sameClassAndNode(p, n),
);
MemoH6.displayName = "MarkdownH6";

type BlockquoteProps = WithNode<JSX.IntrinsicElements["blockquote"]>;
const MemoBlockquote = memo<BlockquoteProps>(
  ({ children, className, node: _node, ...props }: BlockquoteProps) => (
    <blockquote
      className={cn(
        "border-muted-foreground/30 text-muted-foreground my-4 border-l-4 pl-4 text-sm italic",
        className,
      )}
      {...props}
    >
      {children}
    </blockquote>
  ),
  (p, n) => sameClassAndNode(p, n),
);
MemoBlockquote.displayName = "MarkdownBlockquote";

type SupProps = WithNode<JSX.IntrinsicElements["sup"]>;
const MemoSup = memo<SupProps>(
  ({ children, className, node: _node, ...props }: SupProps) => (
    <sup className={cn("text-xs", className)} {...props}>
      {children}
    </sup>
  ),
  (p, n) => sameClassAndNode(p, n),
);
MemoSup.displayName = "MarkdownSup";

type SubProps = WithNode<JSX.IntrinsicElements["sub"]>;
const MemoSub = memo<SubProps>(
  ({ children, className, node: _node, ...props }: SubProps) => (
    <sub className={cn("text-xs", className)} {...props}>
      {children}
    </sub>
  ),
  (p, n) => sameClassAndNode(p, n),
);
MemoSub.displayName = "MarkdownSub";

type ParagraphProps = WithNode<JSX.IntrinsicElements["p"]>;
const MemoParagraph = memo<ParagraphProps>(
  ({ children, className, node: _node, ...props }: ParagraphProps) => {
    const childArray = Array.isArray(children) ? children : [children];
    const validChildren = childArray.filter(
      (child) => child !== null && child !== undefined && child !== "",
    );

    if (
      validChildren.length === 1 &&
      isValidElement(validChildren[0]) &&
      (validChildren[0].props as { node?: MarkdownNode }).node?.tagName === "img"
    ) {
      return <>{children}</>;
    }

    return (
      <p className={cn("text-sm leading-6", className)} {...props}>
        {children}
      </p>
    );
  },
  (p, n) => sameClassAndNode(p, n),
);
MemoParagraph.displayName = "MarkdownParagraph";

const isEmptyFootnote = (listItem: ReactNode): boolean => {
  if (!isValidElement(listItem)) return false;

  const listElement = listItem as ElementWithProps<JSX.IntrinsicElements["li"]>;
  const itemChildren = Array.isArray(listElement.props.children)
    ? listElement.props.children
    : [listElement.props.children];
  let hasContent = false;
  let hasBackref = false;

  for (const itemChild of itemChildren) {
    if (!itemChild) continue;

    if (typeof itemChild === "string") {
      if (itemChild.trim() !== "") {
        hasContent = true;
      }
    } else if (isValidElement(itemChild)) {
      const childProps = itemChild.props as ElementProps<Record<string, unknown>>;
      const childRecord = childProps as Record<string, unknown>;
      if (childRecord["data-footnote-backref"] !== undefined) {
        hasBackref = true;
      } else {
        const grandChildren = Array.isArray(childProps.children)
          ? childProps.children
          : [childProps.children];

        for (const grandChild of grandChildren) {
          if (typeof grandChild === "string" && grandChild.trim() !== "") {
            hasContent = true;
            break;
          }
          if (isValidElement(grandChild)) {
            const grandChildProps = grandChild.props as ElementProps<Record<string, unknown>>;
            const grandChildRecord = grandChildProps as Record<string, unknown>;
            if (grandChildRecord["data-footnote-backref"] === undefined) {
              hasContent = true;
              break;
            }
          }
        }
      }
    }
  }

  return hasBackref && !hasContent;
};

type SectionProps = WithNode<JSX.IntrinsicElements["section"]>;
const MemoSection = memo<SectionProps>(
  ({ children, className, node: _node, ...props }: SectionProps) => {
    const isFootnotesSection = "data-footnotes" in props;

    if (isFootnotesSection) {
      const processedChildren = Array.isArray(children)
        ? children.map((child) => {
            if (!isValidElement(child)) return child;

            if (child.type === MemoOl) {
              const orderedList = child as ElementWithProps<JSX.IntrinsicElements["ol"]>;
              const listChildren = Array.isArray(orderedList.props.children)
                ? orderedList.props.children
                : [orderedList.props.children];
              const filteredListChildren = listChildren.filter(
                (listItem: ReactNode) => !isEmptyFootnote(listItem),
              );

              if (filteredListChildren.length === 0) {
                return null;
              }

              return cloneElement(child, undefined, filteredListChildren);
            }

            return child;
          })
        : children;

      const hasAnyContent = Array.isArray(processedChildren)
        ? processedChildren.some((child) => child !== null)
        : processedChildren !== null;

      if (!hasAnyContent) {
        return null;
      }

      return (
        <section className={className} {...props}>
          {processedChildren}
        </section>
      );
    }

    return (
      <section className={className} {...props}>
        {children}
      </section>
    );
  },
  (p, n) => sameClassAndNode(p, n),
);
MemoSection.displayName = "MarkdownSection";

type InlineCodeProps = WithNode<JSX.IntrinsicElements["code"]>;
const MemoInlineCode = memo<InlineCodeProps>(
  ({ children, className, node: _node, ...props }: InlineCodeProps) => (
    <code className={cn("bg-muted rounded px-1.5 py-0.5 font-mono text-sm", className)} {...props}>
      {children}
    </code>
  ),
  (p, n) => sameClassAndNode(p, n),
);
MemoInlineCode.displayName = "MarkdownInlineCode";

type ImgProps = WithNode<JSX.IntrinsicElements["img"]>;
const MemoImg = memo<ImgProps>(
  ({ alt, className, node: _node, ...props }) => (
    <img alt={alt ?? ""} className={cn("rounded-md", className)} {...props} />
  ),
  (p, n) => sameClassAndNode(p, n) && p.src === n.src && p.alt === n.alt,
);
MemoImg.displayName = "MarkdownImg";

const components: Components = {
  ol: MemoOl,
  li: MemoLi,
  ul: MemoUl,
  hr: MemoHr,
  strong: MemoStrong,
  a: MemoA,
  h1: MemoH1,
  h2: MemoH2,
  h3: MemoH3,
  h4: MemoH4,
  h5: MemoH5,
  h6: MemoH6,
  blockquote: MemoBlockquote,
  inlineCode: MemoInlineCode,
  img: MemoImg,
  sup: MemoSup,
  sub: MemoSub,
  p: MemoParagraph,
  section: MemoSection,
};

// Fenced code and tables stay on Streamdown's built-ins so 2.6 max-height,
// streaming auto-scroll, and download controls apply.
const streamdownPlugins = { code };

export const Response = memo(
  (props: ResponseProps) => {
    const { className, components: overrides, plugins, animated = true, ...rest } = props;

    const mergedComponents = overrides ? { ...components, ...overrides } : components;

    return (
      <Streamdown
        {...rest}
        animated={animated}
        className={cn(
          "size-full text-sm leading-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          className,
        )}
        components={mergedComponents}
        plugins={plugins ? { ...streamdownPlugins, ...plugins } : streamdownPlugins}
      />
    );
  },
  (prev, next) =>
    prev.children === next.children &&
    prev.isAnimating === next.isAnimating &&
    prev.className === next.className,
);

Response.displayName = "Response";
