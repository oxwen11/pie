import type { AgentThinkingLevel } from "@getpie/contract";
import { Button } from "@getpie/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@getpie/ui/components/select";
import { BrainCircuitIcon, ChevronDownIcon } from "lucide-react";

const THINKING_LEVEL_LABELS = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Maximum",
} satisfies Record<AgentThinkingLevel, string>;

export function ThinkingLevelSelect({
  level,
  availableLevels,
  disabled = false,
  onChange,
}: {
  level: AgentThinkingLevel | undefined;
  availableLevels: ReadonlyArray<AgentThinkingLevel>;
  disabled?: boolean;
  onChange: (level: AgentThinkingLevel) => void;
}) {
  if (availableLevels.length <= 1) return null;

  return (
    <Select
      disabled={disabled}
      items={availableLevels.map((value) => ({
        label: THINKING_LEVEL_LABELS[value],
        value,
      }))}
      onValueChange={(next) => {
        if (next !== null && availableLevels.includes(next)) onChange(next);
      }}
      value={level ?? null}
    >
      <SelectTrigger
        aria-label="Thinking depth"
        render={({ children: _children, className: _className, ...triggerProps }) => (
          <Button
            {...triggerProps}
            className="min-w-0 gap-1.5 px-2 font-normal"
            size="sm"
            variant="ghost"
          >
            <BrainCircuitIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
            <SelectValue placeholder="Thinking">
              {(value: AgentThinkingLevel | null) =>
                value === null ? "Thinking" : THINKING_LEVEL_LABELS[value]
              }
            </SelectValue>
            <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
          </Button>
        )}
      />
      <SelectContent alignItemWithTrigger={false}>
        {availableLevels.map((value) => (
          <SelectItem key={value} value={value}>
            {THINKING_LEVEL_LABELS[value]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
