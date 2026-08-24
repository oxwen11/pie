import type { GitPatchFileIssue, GitReviewFile } from "@getpie/contract/git";
import type { FileDiffContentsLoader } from "@pierre/diffs";
import {
  CodeView,
  type CodeViewHandle,
  type CodeViewItem,
  type CodeViewReactOptions,
} from "@pierre/diffs/react";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { parseReviewPatch } from "./review-patch";

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

function itemIdFromInstance(instance: object): string | undefined {
  if (!("fileDiff" in instance)) return undefined;
  const fileDiff = instance.fileDiff;
  if (fileDiff === null || typeof fileDiff !== "object" || !("name" in fileDiff)) return undefined;
  const name = fileDiff.name;
  return typeof name === "string" ? name : undefined;
}

export function ReviewDiffAdapter({
  patch,
  files,
  issues,
  loadDiffFiles,
  locatePath,
  locateRequest,
}: {
  patch: string;
  files: ReadonlyArray<GitReviewFile>;
  issues: ReadonlyArray<GitPatchFileIssue>;
  loadDiffFiles: FileDiffContentsLoader;
  locatePath?: string;
  locateRequest: number;
}) {
  const themeType = useSyncExternalStore(
    subscribeToAppTheme,
    getAppThemeType,
    () => "light" as const,
  );
  const codeViewRef = useRef<CodeViewHandle<undefined>>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [appliedLocate, setAppliedLocate] = useState(locateRequest);
  if (locateRequest !== appliedLocate) {
    setAppliedLocate(locateRequest);
    if (locatePath !== undefined && collapsed.has(locatePath)) {
      const next = new Set(collapsed);
      next.delete(locatePath);
      setCollapsed(next);
    }
  }
  const fileDiffs = useMemo(() => parseReviewPatch(patch, files, issues), [files, issues, patch]);
  const issuesByPath = useMemo(
    () => new Map(issues.map((issue) => [issue.path, issue.reason])),
    [issues],
  );

  const items = useMemo<ReadonlyArray<CodeViewItem>>(
    () =>
      fileDiffs.map((fileDiff) => ({
        id: fileDiff.name,
        type: "diff",
        fileDiff,
        collapsed: collapsed.has(fileDiff.name),
        version: collapsed.has(fileDiff.name) ? 1 : 0,
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
      loadDiffFiles,
      onPostRender(node, instance, phase) {
        if (phase === "unmount") return;
        const header = node.shadowRoot?.querySelector("[data-diffs-header]");
        if (!(header instanceof HTMLElement)) return;
        const id = itemIdFromInstance(instance);
        if (id !== undefined) header.dataset.reviewPath = id;
        if (header.dataset.reviewCollapseBound === "true") return;
        header.dataset.reviewCollapseBound = "true";
        header.addEventListener("click", () => {
          const path = header.dataset.reviewPath;
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
    [loadDiffFiles, themeType],
  );

  const renderHeaderMetadata = useCallback(
    (item: CodeViewItem) => {
      const reason = issuesByPath.get(item.id);
      if (reason === undefined) return null;
      return (
        <span className="text-muted-foreground text-xs">
          {reason === "binary"
            ? "Binary preview unavailable"
            : reason === "too-large"
              ? "File too large to preview"
              : "Preview unavailable"}
        </span>
      );
    },
    [issuesByPath],
  );

  useLayoutEffect(() => {
    if (locatePath === undefined) return;
    if (!fileDiffs.some((fileDiff) => fileDiff.name === locatePath)) return;
    codeViewRef.current?.scrollTo({ type: "item", id: locatePath, align: "start" });
  }, [fileDiffs, locatePath, locateRequest]);

  return (
    <div className="h-full min-h-0 w-full">
      <CodeView
        className="h-full w-full"
        items={items}
        options={options}
        ref={codeViewRef}
        renderHeaderMetadata={renderHeaderMetadata}
      />
    </div>
  );
}
