import {
  PromptInput,
  PromptInputToolbar,
  PromptInputTools,
} from "@getpie/ui/ai-elements/prompt-input";
import { Card, CardFrame } from "@getpie/ui/components/card";
import type { ReactNode } from "react";

import { ChatInput } from "./input/chat-input";
import type { ChatInputController } from "./input/chat-input-controller";
import { ChatInputProvider } from "./input/chat-input-provider";

/** Shared composer chrome. Callers fill the header, toolbar, submit control, and footer. */
export function ChatComposerFrame({
  children,
  className,
  controller,
  footer,
  header,
  layout,
  minRows,
  submit,
  toolbar,
}: {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly controller: ChatInputController | null;
  readonly footer?: ReactNode;
  readonly header?: ReactNode;
  readonly layout?: "inline";
  readonly minRows?: number;
  readonly submit: ReactNode;
  readonly toolbar?: ReactNode;
}) {
  return (
    <CardFrame className={className}>
      {header}
      <Card
        render={
          <PromptInput
            className="divide-y-0"
            data-layout={layout}
            onClick={(event) => {
              if (
                event.defaultPrevented ||
                !(event.target instanceof Element) ||
                event.target.closest(
                  "button, a, input, textarea, select, [contenteditable], [tabindex]",
                )
              ) {
                return;
              }
              controller?.focus();
            }}
            onSubmit={(event) => {
              event.preventDefault();
              void controller?.submit();
            }}
          />
        }
      >
        <ChatInputProvider controller={controller}>
          <ChatInput minRows={minRows} />
          {children}
          <PromptInputToolbar>
            <PromptInputTools>{toolbar}</PromptInputTools>
            {submit}
          </PromptInputToolbar>
        </ChatInputProvider>
      </Card>
      {footer}
    </CardFrame>
  );
}
