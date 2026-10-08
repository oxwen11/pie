import type { Settings, ThemePreference } from "@getpie/contract";
import { Label } from "@getpie/ui/components/label";
import { Radio, RadioGroup } from "@getpie/ui/components/radio-group";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@getpie/ui/components/sidebar";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Palette, SquareTerminal } from "lucide-react";
import type { ReactElement } from "react";

import { PageSidebar } from "@/components/layout/page-sidebar";
import { useLocalOrpc } from "@/lib/environment-orpc";
import { usePlatform } from "@/platform-context";
import { isThemePreference } from "@/theme";
import { useTheme } from "@/theme-provider";

import { CommandLineSettings } from "./command-line-settings";

const THEME_OPTIONS: ReadonlyArray<{ readonly value: ThemePreference; readonly label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function SettingsPage(): ReactElement {
  const { setOpenMobile } = useSidebar();
  const { cli } = usePlatform();
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
    <>
      <PageSidebar>
        <div className="flex h-10 shrink-0 items-center px-4">
          <h2 className="text-sm font-semibold">Settings</h2>
        </div>
        <SidebarGroup className="pt-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive
                onClick={() => setOpenMobile(false)}
                render={<a aria-label="Appearance" href="#appearance" />}
              >
                <Palette />
                <span>Appearance</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {cli === undefined ? null : (
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => setOpenMobile(false)}
                  render={<a aria-label="Command line" href="#command-line" />}
                >
                  <SquareTerminal />
                  <span>Command line</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroup>
      </PageSidebar>
      <div className="flex max-w-lg flex-col gap-6 p-6">
        <h1 className="text-sm font-medium">Settings</h1>
        <section className="flex flex-col gap-3" id="appearance">
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
        {cli === undefined ? null : <CommandLineSettings cli={cli} />}
      </div>
    </>
  );
}
