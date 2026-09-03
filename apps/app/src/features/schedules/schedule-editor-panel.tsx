import { useSchedule } from "./schedule-context";
import { ScheduleCreateForm, ScheduleEditForm } from "./schedule-form";
import {
  SchedulePanel,
  SchedulePanelBody,
  SchedulePanelClose,
  SchedulePanelHeader,
  SchedulePanelTitle,
} from "./schedule-panel";

export function ScheduleEditorPanel() {
  const { actions, meta } = useSchedule();
  if (meta.createOpen) {
    return (
      <SchedulePanel aria-label="New schedule">
        <SchedulePanelHeader>
          <SchedulePanelTitle>New schedule</SchedulePanelTitle>
          <SchedulePanelClose disabled={meta.submitting} onClick={actions.closeCreate} />
        </SchedulePanelHeader>
        <SchedulePanelBody>
          <p className="text-muted-foreground mb-4 text-sm">
            When this is due, pie starts a session in the project and sends the prompt.
          </p>
          <ScheduleCreateForm
            defaults={meta.createDefaults}
            onCancel={actions.closeCreate}
            onSubmit={actions.create}
            projects={meta.projects}
            submitting={meta.submitting}
          />
        </SchedulePanelBody>
      </SchedulePanel>
    );
  }
  const schedule = meta.editing;
  if (schedule === undefined) return null;
  return (
    <SchedulePanel aria-label="Edit schedule">
      <SchedulePanelHeader>
        <SchedulePanelTitle>Edit schedule</SchedulePanelTitle>
        <SchedulePanelClose disabled={meta.submitting} onClick={actions.cancelEdit} />
      </SchedulePanelHeader>
      <SchedulePanelBody>
        <p className="text-muted-foreground mb-4 text-sm">
          When this is due, pie starts a session in the project and sends the prompt.
        </p>
        <ScheduleEditForm
          key={schedule.id}
          onCancel={actions.cancelEdit}
          onSubmit={(value) => actions.save(schedule.id, value)}
          projects={meta.projects}
          schedule={schedule}
          submitting={meta.submitting}
        />
      </SchedulePanelBody>
    </SchedulePanel>
  );
}
