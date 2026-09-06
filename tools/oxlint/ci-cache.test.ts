import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.join(import.meta.dirname, "..", "..");

describe("Code check turbo contracts", () => {
  it("caches lint:check against repo source, not only tools/oxlint", () => {
    const rootTurbo = readJson("turbo.json");
    const lintCheck = rootTurbo.tasks["lint:check"];
    expect(lintCheck.cache).not.toBe(false);
    const inputs = lintCheck.inputs;
    expect(Array.isArray(inputs)).toBe(true);
    if (!Array.isArray(inputs)) return;
    expect(inputs).toEqual(
      expect.arrayContaining([
        "$TURBO_DEFAULT$",
        "$TURBO_ROOT$/apps/**",
        "$TURBO_ROOT$/packages/**",
        "$TURBO_ROOT$/tools/**",
        "$TURBO_ROOT$/oxlint.config.mts",
        "!$TURBO_ROOT$/**/node_modules/**",
        "!$TURBO_ROOT$/**/dist/**",
        "!$TURBO_ROOT$/**/.turbo/**",
      ]),
    );
    expect(inputs).not.toContain("$TURBO_ROOT$/**");
    expect(lintCheck.dependsOn).toEqual(["@getpie/oxlint#build"]);
  });

  it("runs test through turbo so unchanged packages can cache", () => {
    const test = readJson("turbo.json").tasks.test;
    expect(test.cache).not.toBe(false);
    expect(test.dependsOn).toEqual(["^build"]);
    const pieTest = readJson("packages/pie/turbo.json").tasks.test;
    expect(pieTest.dependsOn).toEqual(["build"]);
  });

  it("leaves daemon builds uncached because the dist embeds HEAD", () => {
    for (const relative of [
      "packages/server/turbo.json",
      "packages/pie/turbo.json",
      "apps/desktop/turbo.json",
    ]) {
      const build = readJson(relative).tasks.build;
      expect(build.cache).toBe(false);
      expect(build.env).toBeUndefined();
    }
  });

  it("keeps the five Code check gates in one turbo graph", () => {
    const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/quality.yml"), "utf8");
    expect(workflow).not.toMatch(/continue-on-error/);
    expect(workflow).toContain("pnpm turbo run build test typecheck lint:check");
    expect(workflow).toContain("pnpm run format:check");
    expect(workflow).not.toMatch(/print-daemon-compatibility-key/);
    expect(workflow).not.toMatch(/--passWithNoTests/);

    const rootPackage = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(rootPackage.scripts.test).toBe("turbo run test");
    expect(rootPackage.scripts["format:check"]).toContain("oxfmt --check");

    const oxlintPackage = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "tools/oxlint/package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(oxlintPackage.scripts["lint:check"]).toContain("oxlint --deny-warnings");
  });
});

function readJson(relative: string): {
  tasks: Record<string, Record<string, unknown>>;
} {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relative), "utf8")) as {
    tasks: Record<string, Record<string, unknown>>;
  };
}
