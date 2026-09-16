import type { Project } from "@getpie/contract";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@getpie/ui/components/select";

/** Sentinel that is not a project UUID — allocate a folder on send. */
export const NEW_FOLDER_VALUE = "new-folder";

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

  return (
    <Select
      items={[
        { label: "New folder", value: NEW_FOLDER_VALUE },
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
        <SelectValue placeholder="New folder" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NEW_FOLDER_VALUE}>
          <span className="flex min-w-0 flex-col">
            <span className="truncate">New folder</span>
            {newFolderRoot !== undefined ? (
              <span className="text-muted-foreground truncate text-xs">{newFolderRoot}</span>
            ) : null}
          </span>
        </SelectItem>
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
  );
}
