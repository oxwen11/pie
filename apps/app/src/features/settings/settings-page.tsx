import type { Settings, SettingsView } from "@getpie/contract/settings";
import { Button } from "@getpie/ui/components/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardFrame,
  CardFrameDescription,
  CardFrameHeader,
  CardFrameTitle,
} from "@getpie/ui/components/card";
import { Fieldset, FieldsetLegend } from "@getpie/ui/components/fieldset";
import { Label } from "@getpie/ui/components/label";
import { Radio, RadioGroup } from "@getpie/ui/components/radio-group";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { toast } from "sonner";

import Loader from "@/components/loader";

import { useThemePreference } from "./settings-theme";
import { isTheme, persistTheme, type Theme } from "./theme";

const THEME_OPTIONS: ReadonlyArray<{
  readonly value: Theme;
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: "system",
    label: "System",
    description: "Match the operating system",
  },
  {
    value: "light",
    label: "Light",
    description: "Always use the light theme",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use the dark theme",
  },
];

export function SettingsPage() {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const queryClient = useQueryClient();
  const settingsQuery = useQuery(orpcQueryUtils.settings.get.queryOptions());
  const theme = useThemePreference();
  const settingsKey = orpcQueryUtils.settings.get.queryOptions().queryKey;

  const update = useMutation({
    mutationFn: (settings: Settings) => orpcQueryUtils.settings.update.call(settings),
    onMutate: async (settings) => {
      persistTheme(settings.appearance.theme);
      const previous = queryClient.getQueryData<SettingsView>(settingsKey);
      const optimistic = previous === undefined ? undefined : { ...previous, settings };
      if (optimistic !== undefined) queryClient.setQueryData(settingsKey, optimistic);
      await queryClient.cancelQueries({ queryKey: settingsKey });
      // A fetch that finished during cancel can overwrite the optimistic row.
      if (optimistic !== undefined) queryClient.setQueryData(settingsKey, optimistic);
      persistTheme(settings.appearance.theme);
      return { previous };
    },
    onSuccess: (view) => {
      queryClient.setQueryData(settingsKey, view);
      persistTheme(view.settings.appearance.theme);
    },
    onError: (error, _settings, context) => {
      toast.error(`Failed to save settings: ${error.message}`);
      if (context?.previous !== undefined) {
        queryClient.setQueryData(settingsKey, context.previous);
        persistTheme(context.previous.settings.appearance.theme);
      }
    },
  });

  if (settingsQuery.isPending) {
    return <Loader />;
  }

  if (settingsQuery.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
        <p className="text-muted-foreground text-sm">
          Couldn&apos;t load settings: {settingsQuery.error.message}
        </p>
        <Button onClick={() => void settingsQuery.refetch()} size="sm" variant="outline">
          Retry
        </Button>
      </div>
    );
  }

  const view = settingsQuery.data;
  const locationLabel = view.exists ? "Saved at" : "Will be saved at";

  return (
    <div className="flex h-full items-center justify-center p-4">
      <CardFrame className="w-full max-w-2xl">
        <CardFrameHeader>
          <CardFrameTitle>Appearance</CardFrameTitle>
          <CardFrameDescription>How pie looks on this machine.</CardFrameDescription>
        </CardFrameHeader>
        <Card>
          <CardContent className="flex flex-col gap-6">
            <Fieldset className="flex flex-col gap-3">
              <FieldsetLegend className="text-sm font-medium">Theme</FieldsetLegend>
              <RadioGroup
                disabled={update.isPending}
                onValueChange={(value) => {
                  if (!isTheme(value) || value === theme) return;
                  persistTheme(value);
                  update.mutate({
                    version: 1,
                    appearance: { theme: value },
                  });
                }}
                value={theme}
              >
                {THEME_OPTIONS.map((option) => (
                  <Label
                    className="flex cursor-pointer items-start gap-3 rounded-lg p-1 has-disabled:cursor-not-allowed"
                    key={option.value}
                  >
                    <Radio className="mt-0.5" value={option.value} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm font-medium">{option.label}</span>
                      <span className="text-muted-foreground text-xs">{option.description}</span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            </Fieldset>
          </CardContent>
          <CardFooter className="text-muted-foreground flex-col items-start gap-1 text-xs">
            <span>
              {locationLabel}{" "}
              <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.7rem] break-all">
                {view.path}
              </code>
            </span>
            <span>Hand-edits apply after a reload. Saving here rewrites the file.</span>
          </CardFooter>
        </Card>
      </CardFrame>
    </div>
  );
}
