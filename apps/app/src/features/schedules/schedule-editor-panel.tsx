import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import type { ReactNode } from "react";

import { useSchedule } from "./schedule-context";
import { ScheduleCreateForm, ScheduleEditForm } from "./schedule-form";
import {
  SchedulePanel,
  SchedulePanelBody,
  SchedulePanelClose,
  SchedulePanelHeader,
  SchedulePanelTitle,
} from "./schedule-panel";

const EDITOR_TRANSITION = {
  type: "tween",
  duration: 0.45,
  ease: [0.32, 0.72, 0, 1],
} as const;

export function ScheduleEditorPanel() {
  const { actions, meta } = useSchedule();
  if (meta.createOpen) {
    return (
      <ScheduleEditorFrame
        heading="New"
        onClose={() => actions.closeCreate()}
        submitting={meta.submitting}
      >
        <ScheduleCreateForm
          defaults={meta.createDefaults}
          onCancel={() => actions.closeCreate()}
          onSubmit={(value) => actions.create(value)}
          projects={meta.projects}
          submitting={meta.submitting}
        />
      </ScheduleEditorFrame>
    );
  }
  const schedule = meta.editing;
  if (schedule === undefined) return null;
  return (
    <ScheduleEditorFrame
      heading="Edit"
      onClose={() => actions.cancelEdit()}
      submitting={meta.submitting}
    >
      <ScheduleEditForm
        key={schedule.id}
        onCancel={() => actions.cancelEdit()}
        onSubmit={(value) => actions.save(schedule.id, value)}
        projects={meta.projects}
        schedule={schedule}
        submitting={meta.submitting}
      />
    </ScheduleEditorFrame>
  );
}

function ScheduleEditorFrame({
  heading,
  submitting,
  onClose,
  children,
}: {
  heading: string;
  submitting: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion() === true;
  return (
    <m.div
      animate={{ opacity: 1, transform: "translateX(0%)" }}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      initial={{ opacity: 0, transform: "translateX(100%)" }}
      transition={reduceMotion ? { duration: 0 } : EDITOR_TRANSITION}
    >
      <SchedulePanel aria-label={heading} className="border-s-0">
        <SchedulePanelHeader>
          <SchedulePanelTitle>{heading}</SchedulePanelTitle>
          <SchedulePanelClose disabled={submitting} onClick={onClose} />
        </SchedulePanelHeader>
        <SchedulePanelBody className="overflow-hidden p-0">{children}</SchedulePanelBody>
      </SchedulePanel>
    </m.div>
  );
}
