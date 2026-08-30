/** Apply the OS color scheme before React mounts so the first paint matches system. */
export function applyBootAppearance(): void {
  document.documentElement.classList.toggle(
    "dark",
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
}
