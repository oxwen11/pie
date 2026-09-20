import { Button } from "@getpie/ui/components/button";
import { cn } from "@getpie/ui/lib/utils";
import { ArrowLeft, ChevronRight, Plus } from "lucide-react";
import { useState, type ReactElement } from "react";

import { PackagesPanel, type PackageDetail } from "./packages-panel";
import { SkillsPanel } from "./skills-panel";

const tabs = [
  ["packages", "Packages"],
  ["skills", "Skills"],
] as const;

export function PackagesPage(): ReactElement {
  const [tab, setTab] = useState<(typeof tabs)[number][0]>("packages");
  const [addingSourceOpen, setAddingSourceOpen] = useState(false);
  const [detail, setDetail] = useState<PackageDetail | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between px-3">
        {detail === null ? (
          <div
            aria-label="Browse packages or skills"
            className="flex items-center gap-0.5"
            role="tablist"
          >
            {tabs.map(([value, label]) => (
              <button
                aria-selected={tab === value}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium",
                  tab === value
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
                key={value}
                onClick={() => {
                  setTab(value);
                  if (value !== "packages") setAddingSourceOpen(false);
                }}
                role="tab"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-1 text-sm">
            <Button
              aria-label="Back to packages"
              onClick={() => setDetail(null)}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <ArrowLeft />
            </Button>
            <button
              className="text-muted-foreground hover:text-foreground px-1.5 py-1"
              onClick={() => setDetail(null)}
              type="button"
            >
              Packages
            </button>
            <ChevronRight className="text-muted-foreground size-3.5" />
            <span className="truncate px-1.5 font-medium">{detail.name}</span>
          </div>
        )}
        {detail === null ? (
          <Button
            className="rounded-full"
            onClick={() => {
              setTab("packages");
              setAddingSourceOpen((open) => !open);
            }}
            size="sm"
            type="button"
            variant={addingSourceOpen ? "secondary" : "default"}
          >
            <Plus />
            Add
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "packages" ? (
          <PackagesPanel
            addingSourceOpen={addingSourceOpen}
            detail={detail}
            onAddingSourceOpenChange={setAddingSourceOpen}
            onDetailChange={(next) => {
              setDetail(next);
              if (next !== null) setAddingSourceOpen(false);
            }}
          />
        ) : (
          <SkillsPanel />
        )}
      </div>
    </div>
  );
}
