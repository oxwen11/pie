import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

const html = fs.readFileSync(new URL("../renderer/index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

function bootstrapsDark(storedTheme: string | null, systemPrefersDark: boolean): boolean {
  if (script === undefined) throw new Error("Theme bootstrap script not found");
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
  it("runs before the renderer entry and is allowed by the CSP", () => {
    expect(script).toBeDefined();
    if (script === undefined) return;

    const hash = crypto.createHash("sha256").update(script).digest("base64");
    const policyIndex = html.indexOf('http-equiv="Content-Security-Policy"');
    const bootstrapIndex = html.indexOf(`<script>${script}</script>`);
    const rendererIndex = html.indexOf('<script type="module" src="./main.tsx"></script>');

    expect(html).toContain(`'sha256-${hash}'`);
    expect(policyIndex).toBeGreaterThan(-1);
    expect(policyIndex).toBeLessThan(bootstrapIndex);
    expect(bootstrapIndex).toBeLessThan(rendererIndex);
  });

  it("applies a stored preference before falling back to the system theme", () => {
    expect(bootstrapsDark("dark", false)).toBe(true);
    expect(bootstrapsDark("light", true)).toBe(false);
    expect(bootstrapsDark("system", true)).toBe(true);
    expect(bootstrapsDark(null, false)).toBe(false);
  });
});
