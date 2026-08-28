import type { GetSettingsOutput, Settings } from "@getpie/contract";
import { Button } from "@getpie/ui/components/button";
import {
  Card,
  CardDescription,
  CardFrame,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@getpie/ui/components/card";
import { Label } from "@getpie/ui/components/label";
import { Radio, RadioGroup } from "@getpie/ui/components/radio-group";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import Loader from "@/components/loader";

import { isTheme } from "./appearance";

const THEME_OPTIONS = [
  { value: "system", label: "System", description: "Match the operating system" },
  { value: "light", label: "Light", description: "Always use the light theme" },
  { value: "dark", label: "Dark", description: "Always use the dark theme" },
] as const;

export function SettingsForm() {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const getOptions = orpcQueryUtils.settings.get.queryOptions();
  const query = useQuery(getOptions);

  const save = useMutation({
    mutationFn: (settings: Settings) => orpcQueryUtils.settings.update.call(settings),
    onSuccess: (data) => {
      queryClient.setQueryData(getOptions.queryKey, data);
    },
    onError: (error) => {
      toast.error(`Failed to save settings: ${error.message}`);
      void queryClient.invalidateQueries({ queryKey: orpcQueryUtils.settings.get.key() });
    },
  });

  const applyTheme = (next: GetSettingsOutput, theme: Settings["appearance"]["theme"]) => {
    const settings: Settings = { appearance: { theme } };
    queryClient.setQueryData(getOptions.queryKey, { ...next, settings });
    save.mutate(settings);
  };

  const copyPath = (filePath: string) => {
    void navigator.clipboard.writeText(filePath).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      },
      (error: unknown) => {
        toast.error(
          `Failed to copy path: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );
  };

  if (query.isPending) {
    return <Loader />;
  }

  if (query.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
        <p className="text-muted-foreground text-sm">
          Couldn&apos;t load settings: {query.error.message}
        </p>
        <Button onClick={() => void query.refetch()} size="sm" variant="outline">
          Retry
        </Button>
      </div>
    );
  }

  const { path: configPath, settings } = query.data;

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-4">
      <CardFrame className="w-full max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Theme for this window.</CardDescription>
          </CardHeader>
          <CardPanel>
            <RadioGroup
              value={settings.appearance.theme}
              onValueChange={(value) => {
                if (isTheme(value)) applyTheme(query.data, value);
              }}
            >
              {THEME_OPTIONS.map((option) => {
                const id = `appearance-theme-${option.value}`;
                return (
                  <div
                    key={option.value}
                    className="border-border/70 hover:bg-accent/50 flex items-start gap-2 rounded-lg border p-2.5"
                  >
                    <Radio className="mt-0.5" id={id} value={option.value} />
                    <Label
                      className="flex min-w-0 cursor-pointer flex-col items-start gap-0.5"
                      htmlFor={id}
                    >
                      <span className="text-foreground text-sm">{option.label}</span>
                      <span className="text-muted-foreground text-xs font-normal">
                        {option.description}
                      </span>
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>
          </CardPanel>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Config file</CardTitle>
            <CardDescription>
              TOML on disk. pie writes this file when you change a setting.
            </CardDescription>
          </CardHeader>
          <CardPanel className="flex items-center gap-2">
            <code
              className="bg-muted text-muted-foreground min-w-0 flex-1 truncate rounded-md px-2 py-1.5 font-mono text-xs"
              title={configPath}
            >
              {configPath}
            </code>
            <Button
              aria-label={copied ? "Copied config path" : "Copy config path"}
              onClick={() => copyPath(configPath)}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </CardPanel>
        </Card>
      </CardFrame>
    </div>
  );
}
