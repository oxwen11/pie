import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@getpie/ui/components/empty";
import type { ReactNode } from "react";

import Loader from "@/components/loader";

import { ScheduleProvider, useSchedule, type ScheduleProviderProps } from "./schedule-context";
import { SchedulePageFrame } from "./schedule-page-frame";

type SchedulePageProps = Omit<ScheduleProviderProps, "children">;

export function SchedulePage(props: SchedulePageProps) {
  return (
    <ScheduleProvider {...props}>
      <SchedulePageContent />
    </ScheduleProvider>
  );
}

function SchedulePageContent() {
  const { meta } = useSchedule();
  const placeholder = schedulePagePlaceholder(meta.projectsReady, meta.listPending, meta.listError);
  if (placeholder !== null) return placeholder;
  return <SchedulePageFrame />;
}

function schedulePagePlaceholder(
  projectsReady: boolean,
  listPending: boolean,
  listError: Error | null,
): ReactNode {
  if (!projectsReady || listPending) return <Loader />;
  if (listError === null) return null;
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Could not load schedules</EmptyTitle>
        <EmptyDescription>{listError.message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
