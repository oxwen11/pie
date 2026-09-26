import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@getpie/ui/components/select";

import type { ConnectedEnvironment } from "./use-connected-environments";

/** Draft environment pick. Hidden when only this device is connected. */
export function DraftEnvironmentSelect({
  environments,
  onChange,
  value,
}: {
  environments: ReadonlyArray<ConnectedEnvironment>;
  onChange: (environmentId: string) => void;
  value: string;
}) {
  if (environments.length < 2) return null;
  return (
    <Select
      items={environments.map((environment) => ({
        label: environment.title,
        value: environment.environmentId,
      }))}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next);
      }}
      value={value}
    >
      <SelectTrigger
        aria-label="Environment"
        className="hover:bg-accent w-auto max-w-56 min-w-0 justify-self-start border-transparent bg-transparent shadow-none before:hidden dark:bg-transparent"
        size="sm"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {environments.map((environment) => (
          <SelectItem key={environment.environmentId} value={environment.environmentId}>
            {environment.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
