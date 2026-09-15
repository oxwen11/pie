import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "../package.json"), "utf8"),
) as { dependencies?: Record<string, string> };

describe("published CLI manifest", () => {
  it("uses npm-installable dependency specs, not catalog: or workspace:", () => {
    for (const spec of Object.values(packageJson.dependencies ?? {})) {
      expect(spec).not.toMatch(/^(catalog:|workspace:)/);
    }
  });

  it("does not publish Effect as a runtime dependency (avoids a second copy under npx)", () => {
    expect(packageJson.dependencies ?? {}).not.toHaveProperty("effect");
    expect(packageJson.dependencies ?? {}).not.toHaveProperty("@effect/platform-node");
  });

  it("publishes only native addons as runtime dependencies", () => {
    expect(Object.keys(packageJson.dependencies ?? {})).toEqual(["node-pty"]);
  });
});
