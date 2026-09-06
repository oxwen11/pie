import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { injectThemeBootstrap, themeBootstrapScript } from "../../../app/theme-bootstrap-plugin";

const desktopSource = fs.readFileSync(new URL("../renderer/index.html", import.meta.url), "utf8");
const webSource = fs.readFileSync(new URL("../../../app/index.html", import.meta.url), "utf8");
const desktopHtml = injectThemeBootstrap(desktopSource, { csp: true });
const webHtml = injectThemeBootstrap(webSource);
const script = themeBootstrapScript();

function bootstrapsDark(storedTheme: string | null, systemPrefersDark: boolean): boolean {
  let dark = false;
  vm.runInNewContext(script, {
    document: {
      documentElement: {
        classList: {
          toggle: (_className: string, force: boolean) => {
            dark = force;
          },
        },
      },
    },
    localStorage: { getItem: () => storedTheme },
    window: { matchMedia: () => ({ matches: systemPrefersDark }) },
  });
  return dark;
}

describe("renderer theme bootstrap", () => {
  it("generates the same bootstrap before both renderer entries", () => {
    expect(webHtml.indexOf(`<script>${script}</script>`)).toBeLessThan(
      webHtml.indexOf('<script type="module" src="/src/main.tsx"></script>'),
    );
    expect(desktopHtml.indexOf(`<script>${script}</script>`)).toBeLessThan(
      desktopHtml.indexOf('<script type="module" src="./main.tsx"></script>'),
    );
  });

  it("authorizes the generated desktop bootstrap with the exact CSP hash", () => {
    const hash = crypto.createHash("sha256").update(script).digest("base64");
    const policyIndex = desktopHtml.indexOf('http-equiv="Content-Security-Policy"');
    const bootstrapIndex = desktopHtml.indexOf(`<script>${script}</script>`);

    expect(desktopHtml).toContain(`'sha256-${hash}'`);
    expect(policyIndex).toBeGreaterThan(-1);
    expect(policyIndex).toBeLessThan(bootstrapIndex);
    expect(desktopHtml).not.toContain("__PIE_THEME_BOOTSTRAP_CSP__");
  });

  it("applies a stored preference before falling back to the system theme", () => {
    expect(bootstrapsDark("dark", false)).toBe(true);
    expect(bootstrapsDark("light", true)).toBe(false);
    expect(bootstrapsDark("system", true)).toBe(true);
    expect(bootstrapsDark(null, false)).toBe(false);
  });
});
