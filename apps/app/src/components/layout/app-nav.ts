import { Clock, GitPullRequestIcon, House, Puzzle, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type AppNavItem = {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly search?: Record<string, never>;
  readonly to: "/draft" | "/schedules" | "/pull-requests" | "/plugins" | "/settings";
};

export const appNav = {
  home: { to: "/draft", label: "New chat", icon: House },
  sections: [
    { to: "/schedules", label: "Scheduled", icon: Clock, search: {} },
    { to: "/pull-requests", label: "Pull requests", icon: GitPullRequestIcon },
    { to: "/plugins", label: "Plugins", icon: Puzzle },
  ],
  footer: { to: "/settings", label: "Settings", icon: Settings },
} as const satisfies {
  readonly home: AppNavItem;
  readonly sections: readonly AppNavItem[];
  readonly footer: AppNavItem;
};
