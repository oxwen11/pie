import { Button } from "@getpie/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@getpie/ui/components/empty";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type WorkspaceStateProps = {
  title: string;
  children: ReactNode;
  onRetry?: () => void;
  icon: LucideIcon;
  variant?: "default" | "prominent";
};

export function WorkspaceState({
  title,
  children,
  onRetry,
  icon: Icon,
  variant = "default",
}: WorkspaceStateProps): ReactNode {
  const prominent = variant === "prominent";
  return (
    <Empty className="py-8 md:py-8">
      <EmptyHeader>
        <EmptyMedia className={prominent ? "size-12" : undefined} variant="icon">
          <Icon className={prominent ? "size-6" : undefined} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
      {onRetry ? (
        <EmptyContent>
          <Button onClick={onRetry} size="sm" variant="outline">
            Try again
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
