import type { Schedule, Project } from "@getpie/contract";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@getpie/ui/components/dialog";

import { ScheduleForm, type ScheduleFormSubmit } from "./schedule-form";

export type ScheduleEditorState =
  | { readonly mode: "create"; readonly projectId?: string; readonly sessionId?: string }
  | { readonly mode: "edit"; readonly schedule: Schedule };

export type ScheduleEditorDialogProps = {
  readonly editor: ScheduleEditorState;
  readonly projects: ReadonlyArray<Project>;
  readonly submitting: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (value: ScheduleFormSubmit) => void;
};

export function ScheduleEditorDialog({
  editor,
  projects,
  submitting,
  onClose,
  onSubmit,
}: ScheduleEditorDialogProps) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
      open
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editor.mode === "create" ? "New schedule" : "Edit schedule"}</DialogTitle>
          <DialogDescription>
            When this is due, pie starts a session in the project and sends the prompt.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
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
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
