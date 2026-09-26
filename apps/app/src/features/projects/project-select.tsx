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
import { FolderIcon, XIcon } from "lucide-react";
import { useState } from "react";

/** Sentinel that is not a project UUID — `allocateChatProjectDir` on send. */
const NEW_FOLDER_VALUE = "new-folder";

// Draft project picker for the selected Environment. `null` / Choose project →
// allocate under `~/Pie` on send. `requireProject` (linked host): no null mode,
// because chat-folder allocation is local-only.
export function ProjectSelect({
  onChange,
  projects,
  requireProject = false,
  value,
}: {
  onChange: (projectId: string | null) => void;
  projects: ReadonlyArray<Project>;
  requireProject?: boolean;
  value: string | null;
}) {
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);
  const selected = projects.find((project) => project.id === value);

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
          ...(requireProject ? [] : [{ label: "Choose project", value: NEW_FOLDER_VALUE }]),
          ...projects.map((project) => ({ label: project.name, value: project.id })),
        ]}
        onOpenChange={setOpen}
        onValueChange={(next) => {
          if (next === NEW_FOLDER_VALUE) onChange(null);
          else if (typeof next === "string") onChange(next);
        }}
        open={open}
        value={value ?? NEW_FOLDER_VALUE}
      >
        {/* The name is only the folder's basename, so two projects can share one —
          the path is what actually tells them apart. */}
        {/* The draft header row owns the edge bleed (-mx-4) for every pick; a
          trigger-level margin would stack with it and poke past the card. */}
        <SelectTrigger
          className="hover:bg-accent w-auto max-w-56 min-w-0 justify-self-start border-transparent bg-transparent shadow-none before:hidden dark:bg-transparent [&_[data-slot=select-icon]]:hidden"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          size="sm"
          title={selected?.path}
        >
          {value !== null && !requireProject ? (
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
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{project.name}</span>
                <span className="text-muted-foreground truncate text-xs">{project.path}</span>
              </span>
            </SelectItem>
          ))}
          {value !== null && !requireProject ? (
            <>
              {projects.length > 0 ? <SelectSeparator /> : null}
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
