import { EditorContent, useCurrentEditor } from "@tiptap/react";

// Thin view: renders only the edit area + input styling. The editor comes from
// ChatInputProvider; menus/toolbar/banners are composed by the consumer — no
// data flows through here.
export function ChatInput({ className }: { className?: string }) {
  const { editor } = useCurrentEditor();
  return (
    <EditorContent
      data-slot="chat-input"
      editor={editor}
      className={
        className ??
        "chat-input-scroll-fade max-h-[25dvh] min-h-11 w-full min-w-0 overflow-y-auto text-sm leading-5 font-medium pointer-coarse:text-base [&_.tiptap]:p-3 [&_.tiptap]:outline-none"
      }
    />
  );
}
