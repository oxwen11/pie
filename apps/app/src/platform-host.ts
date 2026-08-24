import type { Platform, PlatformOs } from "./platform";

/** Browser entry point — no native host capabilities. */
export function isWebHost(platform: Platform): boolean {
  return platform.os === undefined;
}

/** Electron (or any native host) — `os` is always set. */
export function isDesktopHost(platform: Platform): platform is Platform & { os: PlatformOs } {
  return platform.os !== undefined;
}

/** Desktop on macOS — native traffic lights overlay the shell chrome. */
export function isDesktopMacosHost(platform: Platform): platform is Platform & { os: "macos" } {
  return platform.os === "macos";
}
