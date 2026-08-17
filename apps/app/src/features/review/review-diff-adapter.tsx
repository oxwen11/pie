import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff, Virtualizer } from "@pierre/diffs/react";
import { useMemo, useSyncExternalStore } from "react";

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

export function ReviewDiffAdapter({
  path,
  oldPath,
  oldContents,
  newContents,
}: {
  path: string;
  oldPath?: string;
  oldContents: string | null;
  newContents: string | null;
}) {
  const themeType = useSyncExternalStore(
    subscribeToAppTheme,
    getAppThemeType,
    () => "light" as const,
  );
  const fileDiff = useMemo(
    () =>
      parseDiffFromFile(
        oldContents === null ? null : { name: oldPath ?? path, contents: oldContents },
        newContents === null ? null : { name: path, contents: newContents },
      ),
    [newContents, oldContents, oldPath, path],
  );
  const options = useMemo(
    () => ({
      disableFileHeader: true,
      overflow: "scroll" as const,
      theme: { dark: "pierre-dark" as const, light: "pierre-light" as const },
      themeType,
      unsafeCSS: DIFF_UNSAFE_CSS,
    }),
    [themeType],
  );

  return (
    <div className="h-full w-full">
      <Virtualizer
        className="h-full w-full overflow-auto"
        contentStyle={{ display: "flex", minHeight: "100%", width: "100%" }}
      >
        <FileDiff className="min-h-full min-w-full" fileDiff={fileDiff} options={options} />
      </Virtualizer>
    </div>
  );
}
