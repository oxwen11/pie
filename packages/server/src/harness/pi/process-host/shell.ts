// UPSTREAM @earendil-works/pi-coding-agent@0.84.2 dist/utils/shell.js
// Local copy of the SIGTERM hook. The parent also force-kills this child after 2s.

export function killTrackedDetachedChildren(): void {
  // Bash pid tracking lives inside the Pi package module graph; the parent
  // ChildProcessSpawner forceKillAfter (2s) is what reaps the OS child tree.
}
