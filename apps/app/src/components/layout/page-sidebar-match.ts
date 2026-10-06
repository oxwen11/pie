export function hasPageSidebar(
  matches: ReadonlyArray<{ readonly staticData: { readonly pageSidebar?: true } }>,
): boolean {
  return matches.some((match) => match.staticData.pageSidebar === true);
}
