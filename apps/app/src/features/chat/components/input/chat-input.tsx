import { cn } from "@getpie/ui/lib/utils";
import type { EditorContentProps } from "@tiptap/react";
import { EditorContent, useCurrentEditor } from "@tiptap/react";

// Height of N text rows: 1lh is this wrapper's leading-5 line box and 0.75rem
// matches the [&_.tiptap]:pt-3 top padding below — change them together.
const rowsHeight = (rows: number) => `calc(${rows}lh + 0.75rem)`;

export type ChatInputProps = Omit<EditorContentProps, "editor" | "ref"> & {
  /** Minimum visible text rows in the empty editor. */
  minRows?: number;
};

// Thin view: editor comes from ChatInputProvider. minRows is inline so it wins
// over any min-h class.
export function ChatInput({ className, minRows, style, ...props }: ChatInputProps) {
  const { editor } = useCurrentEditor();
  return (
    <EditorContent
      data-slot="chat-input"
      editor={editor}
      className={cn(
        "chat-input-scroll-fade max-h-[25dvh] w-full min-w-0 overflow-y-auto text-sm leading-5 font-medium pointer-coarse:text-base [&_.tiptap]:px-3 [&_.tiptap]:pt-3 [&_.tiptap]:outline-none",
        className,
      )}
      style={{ ...style, minHeight: rowsHeight(minRows ?? 1) }}
      {...props}
    />
  );
}
