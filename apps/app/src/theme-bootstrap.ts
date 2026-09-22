export function applyStoredTheme(storageKey: string): void {
  let preference: string | null = null;
  try {
    preference = localStorage.getItem(storageKey);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }

  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle(
    "dark",
    preference === "dark" || (preference !== "light" && systemPrefersDark),
  );
}
