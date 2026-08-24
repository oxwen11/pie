import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@getpie/ui/components/select";

export type DraftWorkspaceMode = "project" | "worktree";

export function DraftWorkspaceSelect({
  mode,
  onModeChange,
  disabled,
}: {
  mode: DraftWorkspaceMode;
  onModeChange: (mode: DraftWorkspaceMode) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      disabled={disabled}
      items={[
        { label: "Current directory", value: "project" },
        { label: "New worktree", value: "worktree" },
      ]}
      onValueChange={(next) => {
        if (next === "project" || next === "worktree") onModeChange(next);
      }}
      value={mode}
    >
      {/* Match ProjectSelect: ghost trigger so it sits as a header action, not a second form field. */}
      <SelectTrigger
        className="hover:bg-accent w-auto min-w-0 border-transparent bg-transparent shadow-none before:hidden dark:bg-transparent"
        size="sm"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="project">Current directory</SelectItem>
        <SelectItem value="worktree">New worktree</SelectItem>
      </SelectContent>
    </Select>
  );
}
