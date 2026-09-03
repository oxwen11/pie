import type { Project, Schedule } from "@getpie/contract";

import { ScheduleCreateForm, ScheduleEditForm, type ScheduleFormSubmit } from "./schedule-form";
import {
  SchedulePanel,
  SchedulePanelBody,
  SchedulePanelClose,
  SchedulePanelHeader,
  SchedulePanelTitle,
} from "./schedule-panel";

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
  const heading = editor.mode === "create" ? "New schedule" : "Edit schedule";
  return (
    <SchedulePanel aria-label={heading}>
      <SchedulePanelHeader>
        <SchedulePanelTitle>{heading}</SchedulePanelTitle>
        <SchedulePanelClose disabled={submitting} onClick={onClose} />
      </SchedulePanelHeader>
      <SchedulePanelBody>
        <p className="text-muted-foreground mb-4 text-sm">
          When this is due, pie starts a session in the project and sends the prompt.
        </p>
        {editor.mode === "create" ? (
          <ScheduleCreateForm
            defaults={{ projectId: editor.projectId, sessionId: editor.sessionId }}
            onCancel={onClose}
            onSubmit={onSubmit}
            projects={projects}
            submitting={submitting}
          />
        ) : (
          <ScheduleEditForm
            key={editor.schedule.id}
            onCancel={onClose}
            onSubmit={onSubmit}
            projects={projects}
            schedule={editor.schedule}
            submitting={submitting}
          />
        )}
      </SchedulePanelBody>
    </SchedulePanel>
  );
}
