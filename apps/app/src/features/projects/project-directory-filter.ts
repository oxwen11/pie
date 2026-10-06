export interface ProjectDirectoryEntry {
  value: string;
  label: string;
  kind: "up" | "dir";
}

const withoutTrailingSeparators = (value: string) => value.replace(/[\\/]+$/, "");

/** Typed text always wins, including `/`, `\`, and other path characters. */
export const folderBrowserInputValue = (
  query: string | null,
  currentPath: string | undefined,
): string => query ?? currentPath ?? "";

/**
 * A trailing separator drills into that directory. The current directory's own
 * trailing separator is not a drill — the character stays in the field.
 */
export const folderBrowserDrillPath = (
  currentPath: string | undefined,
  next: string,
): string | null => {
  if (!next.endsWith("/") && !next.endsWith("\\")) return null;
  const target = withoutTrailingSeparators(next);
  if (target.length === 0) return next;
  if (currentPath !== undefined && target === withoutTrailingSeparators(currentPath)) return null;
  return target;
};

export const folderBrowserLeafFilter = (
  currentPath: string | undefined,
  inputValue: string,
): string => {
  if (currentPath === undefined) return "";
  if (
    inputValue === currentPath ||
    inputValue === `${currentPath}/` ||
    inputValue === `${currentPath}\\`
  ) {
    return "";
  }
  if (inputValue.startsWith(currentPath)) {
    return inputValue.slice(currentPath.length).replace(/^[\\/]+/, "");
  }
  return inputValue;
};

const isExactPathSearch = (entry: ProjectDirectoryEntry, search: string): boolean =>
  withoutTrailingSeparators(entry.value) === withoutTrailingSeparators(search);

export const isProjectDirectoryEntryVisible = (
  entry: ProjectDirectoryEntry,
  search: string,
): boolean =>
  entry.kind !== "dir" ||
  !entry.label.startsWith(".") ||
  search.startsWith(".") ||
  isExactPathSearch(entry, search);

export const projectDirectoryEntryMatches = (entry: unknown, search: string): boolean => {
  if (
    typeof entry !== "object" ||
    entry === null ||
    !("label" in entry) ||
    typeof entry.label !== "string" ||
    !("value" in entry) ||
    typeof entry.value !== "string"
  ) {
    return false;
  }

  const query = withoutTrailingSeparators(search).toLocaleLowerCase();
  if (query.length === 0) return true;

  return (
    entry.label.toLocaleLowerCase().includes(query) ||
    withoutTrailingSeparators(entry.value).toLocaleLowerCase().includes(query)
  );
};
