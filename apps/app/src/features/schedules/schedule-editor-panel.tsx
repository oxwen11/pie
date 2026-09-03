import type { Schedule, Project } from "@getpie/contract";
import { Button } from "@getpie/ui/components/button";
import { XIcon } from "lucide-react";

import { ScheduleForm, type ScheduleFormSubmit } from "./schedule-form";

export type ScheduleEditorState =
  | { readonly mode: "create"; readonly projectId?: string; readonly sessionId?: string }
  | { readonly mode: "edit"; readonly schedule: Schedule };

export type ScheduleEditorPanelProps = {
  readonly editor: ScheduleEditorState;
  readonly projects: ReadonlyArray<Project>;
  readonly submitting: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (value: ScheduleFormSubmit) => void;
};

export function ScheduleEditorPanel({
  editor,
  projects,
  submitting,
  onClose,
  onSubmit,
}: ScheduleEditorPanelProps) {
  return (
    <aside
      aria-label={editor.mode === "create" ? "New schedule" : "Edit schedule"}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-s"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
          {editor.mode === "create" ? "New schedule" : "Edit schedule"}
        </h2>
        <Button
          aria-label="Close"
          disabled={submitting}
          onClick={onClose}
          size="icon-xs"
          variant="ghost"
        >
          <XIcon className="size-3.5" />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        <p className="text-muted-foreground mb-4 text-sm">
          When this is due, pie starts a session in the project and sends the prompt.
        </p>
        <ScheduleForm
          key={editor.mode === "edit" ? editor.schedule.id : "create"}
          defaults={
            editor.mode === "create"
              ? { projectId: editor.projectId, sessionId: editor.sessionId }
              : undefined
          }
          initial={editor.mode === "edit" ? editor.schedule : undefined}
          onCancel={onClose}
          onSubmit={onSubmit}
          projects={projects}
          submitting={submitting}
        />
      </div>
    </aside>
  );
}
