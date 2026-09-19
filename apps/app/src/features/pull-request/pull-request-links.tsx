import {
  pullRequestKey,
  type PullRequestProjection,
  type PullRequestRef,
} from "@getpie/contract/pull-request";
import { Button } from "@getpie/ui/components/button";

export function PullRequestLinks({
  projection,
  selected,
  onSelect,
  onExclude,
  excluding,
}: {
  projection: PullRequestProjection;
  selected: string | null;
  onSelect: (key: string) => void;
  onExclude: (ref: PullRequestRef) => void;
  excluding: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 border-b p-3" aria-label="Linked pull requests">
      {projection.groups.map((group) => (
        <section key={pullRequestKey(group.links[0]!.ref)} className="flex flex-col gap-1">
          <h3 className="text-muted-foreground text-xs font-medium">
            {group.type === "native"
              ? `Native Stack #${group.stack?.number} · ${group.links.length} layers · bottom to top`
              : "Pull request"}
          </h3>
          {group.links.map((link) => {
            const key = pullRequestKey(link.ref);
            const lifecycle = link.snapshot?.lifecycle;
            const label =
              lifecycle?.type === "open" && lifecycle.draft
                ? "draft"
                : (lifecycle?.type ?? "unknown");
            return (
              <div key={key} className="flex items-center gap-1">
                <Button
                  className="h-auto min-w-0 flex-1 flex-col items-start gap-0.5 py-2 text-start"
                  variant={key === selected ? "secondary" : "ghost"}
                  aria-pressed={key === selected}
                  onClick={() => onSelect(key)}
                  title={key}
                >
                  <span className="w-full truncate">
                    {link.ref.owner}/{link.ref.repository}#{link.ref.number} · {label}
                  </span>
                  <span className="text-muted-foreground w-full truncate text-xs">
                    {link.snapshot?.title ?? "Not yet verified"}
                  </span>
                  <span className="text-muted-foreground text-[10px]">
                    {link.snapshot
                      ? `Last checked ${link.snapshot.checkedAt}`
                      : "Identity saved; status unknown"}
                  </span>
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={excluding}
                  onClick={() => onExclude(link.ref)}
                  aria-label={`Cancel association with ${key}`}
                >
                  Unlink
                </Button>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
