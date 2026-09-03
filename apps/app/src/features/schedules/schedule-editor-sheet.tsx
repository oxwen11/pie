import type { Schedule, Project } from "@getpie/contract";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@getpie/ui/components/sheet";

import { ScheduleForm, type ScheduleFormSubmit } from "./schedule-form";

export type ScheduleEditorState =
  | { readonly mode: "create"; readonly projectId?: string; readonly sessionId?: string }
  | { readonly mode: "edit"; readonly schedule: Schedule };

export type ScheduleEditorSheetProps = {
  readonly editor: ScheduleEditorState;
  readonly projects: ReadonlyArray<Project>;
  readonly submitting: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (value: ScheduleFormSubmit) => void;
};

export function ScheduleEditorSheet({
  editor,
  projects,
  submitting,
  onClose,
  onSubmit,
}: ScheduleEditorSheetProps) {
  return (
    <Sheet
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
      open
    >
      <SheetPopup className="w-[min(92vw,30rem)]">
        <SheetHeader>
          <SheetTitle>{editor.mode === "create" ? "New schedule" : "Edit schedule"}</SheetTitle>
          <SheetDescription>
            When this is due, pie starts a session in the project and sends the prompt.
          </SheetDescription>
        </SheetHeader>
        <SheetPanel>
          <ScheduleForm
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
        </SheetPanel>
      </SheetPopup>
    </Sheet>
  );
}
