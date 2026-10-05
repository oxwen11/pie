import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@getpie/ui/components/empty";
import { useState, type ReactNode } from "react";

import { PageSidebar } from "@/components/layout/page-sidebar";
import Loader from "@/components/loader";

import { ScheduleProvider, useSchedule, type ScheduleProviderProps } from "./schedule-context";
import { SchedulePageFrame } from "./schedule-page-frame";
import { SchedulePageList } from "./schedule-page-list";

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
  // Keep list filters above the portal. Closing the mobile sheet unmounts the portaled list.
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "paused">("all");
  const placeholder = schedulePagePlaceholder(meta.projectsReady, meta.listPending, meta.listError);
  return (
    <>
      <PageSidebar>
        <SchedulePageList filter={filter} onFilter={setFilter} onQuery={setQuery} query={query} />
      </PageSidebar>
      {placeholder ?? <SchedulePageFrame />}
    </>
  );
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
