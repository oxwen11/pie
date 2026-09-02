import type { SessionPendingPrompt } from "@getpie/contract";
import { Button } from "@getpie/ui/components/button";
import { Input } from "@getpie/ui/components/input";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

export type QueuedPromptKind = "steering" | "followUp";

export function replaceQueuedItem(
  pending: SessionPendingPrompt,
  kind: QueuedPromptKind,
  index: number,
  text: string,
): SessionPendingPrompt {
  const items = pending[kind];
  if (index < 0 || index >= items.length) return pending;
  const next = items.slice();
  next[index] = text;
  return { ...pending, [kind]: next };
}

export function removeQueuedItem(
  pending: SessionPendingPrompt,
  kind: QueuedPromptKind,
  index: number,
): SessionPendingPrompt {
  const items = pending[kind];
  if (index < 0 || index >= items.length) return pending;
  return { ...pending, [kind]: items.filter((_, itemIndex) => itemIndex !== index) };
}

export function ChatInputQueue({
  pending,
  onReplace,
}: {
  pending: SessionPendingPrompt;
  onReplace: (next: SessionPendingPrompt) => void;
}) {
  const count = pending.steering.length + pending.followUp.length;
  if (count === 0) return null;

  return (
    <div className="flex w-full min-w-0 flex-col gap-1" data-slot="chat-input-queue">
      <p className="text-muted-foreground text-xs font-medium">
        {count === 1 ? "1 queued message" : `${count} queued messages`}
      </p>
      <ul aria-label="Queued messages" className="flex w-full min-w-0 flex-col gap-0.5">
        {pending.steering.map((text, index) => (
          <ChatInputQueueItem
            key={`steering:${index}:${text}`}
            kind="steering"
            text={text}
            onRemove={() => onReplace(removeQueuedItem(pending, "steering", index))}
            onSave={(next) => onReplace(replaceQueuedItem(pending, "steering", index, next))}
          />
        ))}
        {pending.followUp.map((text, index) => (
          <ChatInputQueueItem
            key={`followUp:${index}:${text}`}
            kind="followUp"
            text={text}
            onRemove={() => onReplace(removeQueuedItem(pending, "followUp", index))}
            onSave={(next) => onReplace(replaceQueuedItem(pending, "followUp", index, next))}
          />
        ))}
      </ul>
    </div>
  );
}

function ChatInputQueueItem({
  kind,
  text,
  onRemove,
  onSave,
}: {
  kind: QueuedPromptKind;
  text: string;
  onRemove: () => void;
  onSave: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const trimmed = draft?.trim() ?? "";
  const editing = draft !== null;

  if (editing) {
    return (
      <li className="flex min-w-0 items-center gap-1.5">
        {kind === "steering" ? <SteerBadge /> : null}
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed.length === 0) return;
            onSave(trimmed);
            setDraft(null);
          }}
        >
          <Input
            aria-label="Edit queued message"
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setDraft(null);
              }
            }}
            size="sm"
            value={draft}
          />
        </form>
      </li>
    );
  }

  return (
    <li
      className="hover:bg-muted/60 flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5"
      title={text}
    >
      {kind === "steering" ? <SteerBadge /> : null}
      <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">{text}</span>
      <span className="flex shrink-0 items-center gap-0.5">
        <Button
          aria-label="Edit queued message"
          onClick={() => setDraft(text)}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <PencilIcon />
        </Button>
        <Button
          aria-label="Remove queued message"
          onClick={onRemove}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <Trash2Icon />
        </Button>
      </span>
    </li>
  );
}

function SteerBadge() {
  return <span className="text-foreground shrink-0 text-xs font-medium">Steer</span>;
}
