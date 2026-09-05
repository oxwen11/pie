import { parsePatchFiles } from "@pierre/diffs";
import { CodeView, type CodeViewItem, type CodeViewReactOptions } from "@pierre/diffs/react";
import { useMemo, useState, useSyncExternalStore } from "react";

const DIFF_UNSAFE_CSS = `
  :host {
    --diffs-font-family: var(--font-mono);
    --diffs-light-bg: var(--background);
    --diffs-dark-bg: var(--background);
    --diffs-light: var(--foreground);
    --diffs-dark: var(--foreground);
    --diffs-fg-number-override: var(--muted-foreground);
    --diffs-bg-buffer-override: var(--background);
    --diffs-bg-context-override: var(--background);
    --diffs-bg-context-gutter-override: var(--background);
    --diffs-bg-separator-override: var(--border);
    min-height: 100%;
    width: 100%;
  }

  [data-diffs-header] {
    cursor: pointer;
  }
`;

const getAppThemeType = (): "dark" | "light" =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

const subscribeToAppTheme = (listener: () => void): (() => void) => {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributeFilter: ["class"],
    attributes: true,
  });
  return () => observer.disconnect();
};

function itemIdFromInstance(instance: {
  readonly fileDiff?: { readonly name?: unknown } | null;
}): string | undefined {
  const fileDiff = instance.fileDiff;
  if (fileDiff === null || typeof fileDiff !== "object" || !("name" in fileDiff)) return undefined;
  const name = fileDiff.name;
  return typeof name === "string" ? name : undefined;
}

export function PullRequestDiffAdapter({ patch }: { patch: string }) {
  const themeType = useSyncExternalStore(
    subscribeToAppTheme,
    getAppThemeType,
    () => "light" as const,
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const fileDiffs = useMemo(
    () => parsePatchFiles(patch).flatMap((parsed) => parsed.files),
    [patch],
  );

  const items = useMemo<ReadonlyArray<CodeViewItem>>(
    () =>
      fileDiffs.map((fileDiff) => ({
        id: fileDiff.name,
        type: "diff",
        fileDiff,
        collapsed: collapsed.has(fileDiff.name),
      })),
    [collapsed, fileDiffs],
  );

  const options = useMemo<CodeViewReactOptions>(
    () => ({
      overflow: "scroll",
      stickyHeaders: true,
      theme: { dark: "pierre-dark", light: "pierre-light" },
      themeType,
      unsafeCSS: DIFF_UNSAFE_CSS,
      onPostRender(node, instance, phase) {
        if (phase === "unmount") return;
        const header = node.shadowRoot?.querySelector("[data-diffs-header]");
        if (!(header instanceof HTMLElement)) return;
        const id = "fileDiff" in instance ? itemIdFromInstance(instance) : undefined;
        if (id !== undefined) header.dataset.pullRequestPath = id;
        if (header.dataset.pullRequestCollapseBound === "true") return;
        header.dataset.pullRequestCollapseBound = "true";
        header.addEventListener("click", () => {
          const path = header.dataset.pullRequestPath;
          if (path === undefined) return;
          setCollapsed((current) => {
            const next = new Set(current);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
          });
        });
      },
    }),
    [themeType],
  );

  return (
    <div className="h-full min-h-0 w-full">
      <CodeView className="h-full w-full overflow-auto" items={items} options={options} />
    </div>
  );
}
