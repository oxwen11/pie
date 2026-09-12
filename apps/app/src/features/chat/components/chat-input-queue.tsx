import type { SessionPendingPrompt } from "@getpie/contract";
import { Button } from "@getpie/ui/components/button";
import { Input } from "@getpie/ui/components/input";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import {
  type QueuedPromptKind,
  promoteQueuedFollowUp,
  queuedPromptKey,
  removeQueuedItem,
  replaceQueuedItem,
} from "./chat-input-queue-model";

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
        {pending.steering.map((text, position) => (
          <ChatInputQueueItem
            key={queuedPromptKey("steering", pending.steering, position)}
            kind="steering"
            text={text}
            onRemove={() => onReplace(removeQueuedItem(pending, "steering", position))}
            onSave={(next) => onReplace(replaceQueuedItem(pending, "steering", position, next))}
          />
        ))}
        {pending.followUp.map((text, position) => (
          <ChatInputQueueItem
            key={queuedPromptKey("followUp", pending.followUp, position)}
            kind="followUp"
            text={text}
            onPromote={() => onReplace(promoteQueuedFollowUp(pending, position))}
            onRemove={() => onReplace(removeQueuedItem(pending, "followUp", position))}
            onSave={(next) => onReplace(replaceQueuedItem(pending, "followUp", position, next))}
          />
        ))}
      </ul>
    </div>
  );
}

function ChatInputQueueItem({
  kind,
  text,
  onPromote,
  onRemove,
  onSave,
}: {
  kind: QueuedPromptKind;
  text: string;
  onPromote?: () => void;
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
        {onPromote ? (
          <Button
            aria-label="Steer queued message"
            onClick={onPromote}
            size="xs"
            type="button"
            variant="ghost"
          >
            Send
          </Button>
        ) : null}
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
