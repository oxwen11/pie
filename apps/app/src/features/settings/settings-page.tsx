import type { Settings, ThemePreference } from "@getpie/contract";
import { Label } from "@getpie/ui/components/label";
import { Radio, RadioGroup } from "@getpie/ui/components/radio-group";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";

import { useLocalOrpc } from "@/lib/environment-orpc";
import { isThemePreference } from "@/theme";
import { useTheme } from "@/theme-provider";

const THEME_OPTIONS: ReadonlyArray<{ readonly value: ThemePreference; readonly label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function SettingsPage(): ReactElement {
  const orpcQueryUtils = useLocalOrpc();
  const queryClient = useQueryClient();
  const { setTheme, theme } = useTheme();
  const settingsQuery = useQuery({
    ...orpcQueryUtils.settings.get.queryOptions(),
  });
  const settingsQueryKey = orpcQueryUtils.settings.get.queryOptions().queryKey;
  const updateSettings = useMutation({
    mutationKey: orpcQueryUtils.settings.update.key(),
    mutationFn: (next: Settings) => orpcQueryUtils.settings.update.call(next),
    onSuccess: (data) => {
      queryClient.setQueryData(settingsQueryKey, data);
    },
  });
  const value = settingsQuery.data?.appearance.theme ?? theme;

  return (
    <div className="flex max-w-lg flex-col gap-6 p-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Appearance</h2>
        <RadioGroup
          className="gap-2"
          disabled={updateSettings.isPending}
          value={value}
          onValueChange={(next) => {
            if (!isThemePreference(next)) return;
            const settings = { appearance: { theme: next } };
            queryClient.setQueryData(settingsQueryKey, settings);
            setTheme(next);
            updateSettings.mutate(settings);
          }}
        >
          {THEME_OPTIONS.map((option) => (
            <Label key={option.value} className="flex cursor-pointer items-center gap-2">
              <Radio value={option.value} />
              <span>{option.label}</span>
            </Label>
          ))}
        </RadioGroup>
      </section>
    </div>
  );
}
