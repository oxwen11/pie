import crypto from "node:crypto";

import type { Plugin } from "vite";

import { DEFAULT_THEME_STORAGE_KEY } from "./src/theme";
import { applyStoredTheme } from "./src/theme-bootstrap";

const BOOTSTRAP_MARKER = "<!-- pie-theme-bootstrap -->";
const CSP_MARKER = "__PIE_THEME_BOOTSTRAP_CSP__";

export function themeBootstrapScript(storageKey = DEFAULT_THEME_STORAGE_KEY): string {
  return `(${applyStoredTheme.toString()})(${JSON.stringify(storageKey)});`;
}

export function injectThemeBootstrap(
  html: string,
  { csp = false, storageKey = DEFAULT_THEME_STORAGE_KEY } = {},
): string {
  const script = themeBootstrapScript(storageKey);
  const scriptTag = `<script>${script}</script>`;

  if (!html.includes(BOOTSTRAP_MARKER)) {
    throw new Error(`Theme bootstrap marker not found: ${BOOTSTRAP_MARKER}`);
  }

  let transformed = html.replace(BOOTSTRAP_MARKER, scriptTag);
  if (csp) {
    const hash = crypto.createHash("sha256").update(script).digest("base64");
    transformed = transformed.replace(CSP_MARKER, `'sha256-${hash}'`);
  }
  return transformed;
}

export function themeBootstrapPlugin(options?: { csp?: boolean; storageKey?: string }): Plugin {
  return {
    name: "pie:theme-bootstrap",
    transformIndexHtml: (html) => injectThemeBootstrap(html, options),
  };
}
