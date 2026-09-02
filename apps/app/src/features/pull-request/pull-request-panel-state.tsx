import { GitPullRequestIcon } from "lucide-react";
import type { ReactNode } from "react";

export function PullRequestPanelState({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="text-muted-foreground flex max-w-sm flex-col items-center gap-3 text-center text-sm">
        <GitPullRequestIcon className="size-8" />
        <h2 className="text-foreground text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
