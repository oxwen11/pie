import type { Project } from "@getpie/contract";
import { Button } from "@getpie/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@getpie/ui/components/select";
import { XIcon } from "lucide-react";

/** Sentinel that is not a project UUID — allocate a folder on send. */
export const NEW_FOLDER_VALUE = "new-folder";

const NEW_FOLDER_LABEL = "New folder";
const CLEAR_PROJECT_LABEL = "Don't work in a project";

// Project picker for the draft surface. `null` means New folder: send allocates
// a directory under the new-project root and registers it as a Project.
export function ProjectSelect({
  newFolderRoot,
  onChange,
  projects,
  value,
}: {
  newFolderRoot?: string;
  onChange: (projectId: string | null) => void;
  projects: ReadonlyArray<Project>;
  value: string | null;
}) {
  const selected = projects.find((project) => project.id === value);
  const hasProject = value !== null;
  const folderItemLabel = hasProject ? CLEAR_PROJECT_LABEL : NEW_FOLDER_LABEL;

  return (
    <div className="flex min-w-0 items-center" data-slot="project-select">
      <Select
        items={[
          { label: folderItemLabel, value: NEW_FOLDER_VALUE },
          ...projects.map((project) => ({ label: project.name, value: project.id })),
        ]}
        onValueChange={(next) => {
          if (next === NEW_FOLDER_VALUE) onChange(null);
          else if (typeof next === "string") onChange(next);
        }}
        value={value ?? NEW_FOLDER_VALUE}
      >
        {/* The name is only the folder's basename, so two projects can share one —
          the path is what actually tells them apart. */}
        {/* The draft header row owns the edge bleed (-mx-4) for every pick; a
          trigger-level margin would stack with it and poke past the card. */}
        <SelectTrigger
          className="hover:bg-accent w-auto max-w-56 min-w-0 justify-self-start border-transparent bg-transparent shadow-none before:hidden dark:bg-transparent"
          size="sm"
          title={selected?.path ?? newFolderRoot}
        >
          <SelectValue placeholder={NEW_FOLDER_LABEL} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NEW_FOLDER_VALUE}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{folderItemLabel}</span>
              {newFolderRoot !== undefined ? (
                <span className="text-muted-foreground truncate text-xs">{newFolderRoot}</span>
              ) : null}
            </span>
          </SelectItem>
          {hasProject && projects.length > 0 ? <SelectSeparator /> : null}
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{project.name}</span>
                <span className="text-muted-foreground truncate text-xs">{project.path}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hasProject ? (
        <Button
          aria-label="Clear project"
          data-slot="project-select-clear"
          onClick={() => {
            onChange(null);
          }}
          size="icon-xs"
          variant="ghost"
        >
          <XIcon />
        </Button>
      ) : null}
    </div>
  );
}
