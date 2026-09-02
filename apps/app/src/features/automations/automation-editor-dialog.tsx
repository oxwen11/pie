import type { Automation, Project } from "@getpie/contract";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@getpie/ui/components/dialog";

import { AutomationForm, type AutomationFormSubmit } from "./automation-form";

export type AutomationEditorState =
  | { readonly mode: "create"; readonly projectId?: string; readonly sessionId?: string }
  | { readonly mode: "edit"; readonly automation: Automation };

export type AutomationEditorDialogProps = {
  readonly editor: AutomationEditorState;
  readonly projects: ReadonlyArray<Project>;
  readonly submitting: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (value: AutomationFormSubmit) => void;
};

export function AutomationEditorDialog({
  editor,
  projects,
  submitting,
  onClose,
  onSubmit,
}: AutomationEditorDialogProps) {
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
          <AutomationForm
            defaults={
              editor.mode === "create"
                ? { projectId: editor.projectId, sessionId: editor.sessionId }
                : undefined
            }
            initial={editor.mode === "edit" ? editor.automation : undefined}
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
