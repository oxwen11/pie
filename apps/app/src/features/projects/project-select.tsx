import type { Project } from "@getpie/contract";
import { Button } from "@getpie/ui/components/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@getpie/ui/components/select";
import { FolderIcon, XIcon } from "lucide-react";
import { useState } from "react";

/** Sentinel that is not a project UUID — `allocateChatProjectDir` on send. */
const NEW_FOLDER_VALUE = "new-folder";

/** One Environment's imported projects, in switcher order. */
export type ProjectGroup = {
  readonly environmentId: string;
  readonly environmentTitle: string;
  readonly projects: ReadonlyArray<Project>;
};

/** A pick names the project and the Environment that owns it. */
export type ProjectSelection = {
  readonly environmentId: string;
  readonly project: Project;
};

const selectionValue = (environmentId: string, projectId: string): string =>
  `${environmentId}:${projectId}`;

// One picker. Multiple Environments are groups inside it — not a prior
// environment select. `null` / Choose project allocates under `~/Pie` locally.
export function ProjectSelect({
  groups,
  onChange,
  value,
}: {
  readonly groups: ReadonlyArray<ProjectGroup>;
  onChange: (next: ProjectSelection | null) => void;
  readonly value: { environmentId: string; projectId: string } | null;
}) {
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);
  const labeled = groups.length > 1;
  const selectedGroup = groups.find((entry) => entry.environmentId === value?.environmentId);
  const selectedProject = selectedGroup?.projects.find(
    (project) => project.id === value?.projectId,
  );

  return (
    <div
      className="flex min-w-0 items-center"
      data-slot="project-select"
      onPointerDownCapture={(event) => {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest("[data-slot=project-select-clear]")) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onChange(null);
      }}
    >
      <Select
        items={[
          { label: "Choose project", value: NEW_FOLDER_VALUE },
          ...groups.flatMap((entry) =>
            entry.projects.map((project) => ({
              label: project.name,
              value: selectionValue(entry.environmentId, project.id),
            })),
          ),
        ]}
        onOpenChange={setOpen}
        onValueChange={(next) => {
          if (next === NEW_FOLDER_VALUE) {
            onChange(null);
            return;
          }
          for (const entry of groups) {
            const project = entry.projects.find(
              (candidate) => selectionValue(entry.environmentId, candidate.id) === next,
            );
            if (project !== undefined) {
              onChange({ environmentId: entry.environmentId, project });
              return;
            }
          }
        }}
        open={open}
        value={
          value === null ? NEW_FOLDER_VALUE : selectionValue(value.environmentId, value.projectId)
        }
      >
        <SelectTrigger
          className="hover:bg-accent w-auto max-w-56 min-w-0 justify-self-start border-transparent bg-transparent shadow-none before:hidden dark:bg-transparent [&_[data-slot=select-icon]]:hidden"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          size="sm"
          title={selectedProject?.path}
        >
          {value !== null ? (
            <span
              aria-label="Clear project"
              className={
                hovered
                  ? "bg-muted relative z-10 inline-flex size-4 items-center justify-center rounded-full"
                  : "relative z-10 inline-flex size-4 items-center justify-center"
              }
              data-slot="project-select-clear"
            >
              {hovered ? <XIcon className="size-2.5" /> : <FolderIcon />}
            </span>
          ) : (
            <FolderIcon data-slot="project-select-folder" />
          )}
          <SelectValue placeholder="Choose project" />
        </SelectTrigger>
        <SelectContent>
          {groups.map((entry) => (
            <SelectGroup key={entry.environmentId}>
              {labeled ? <SelectGroupLabel>{entry.environmentTitle}</SelectGroupLabel> : null}
              {entry.projects.map((project) => (
                <SelectItem
                  key={selectionValue(entry.environmentId, project.id)}
                  value={selectionValue(entry.environmentId, project.id)}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{project.name}</span>
                    <span className="text-muted-foreground truncate text-xs">{project.path}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
          {value !== null ? (
            <>
              {groups.length > 0 ? <SelectSeparator /> : null}
              <Button
                className="w-full justify-start"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                size="sm"
                variant="ghost"
              >
                Don&apos;t work in a project
              </Button>
            </>
          ) : null}
        </SelectContent>
      </Select>
    </div>
  );
}
