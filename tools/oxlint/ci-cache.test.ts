import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.join(import.meta.dirname, "..", "..");

describe("Code check cache contracts", () => {
  it("hashes the whole repo for lint:check so an edit outside tools/oxlint is a miss", () => {
    const rootTurbo = readJson("turbo.json");
    const lintCheck = rootTurbo.tasks["lint:check"] as Record<string, unknown>;
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

  it("hashes PIE_DAEMON_COMPATIBILITY_KEY on daemon builds instead of disabling cache", () => {
    for (const relative of [
      "packages/server/turbo.json",
      "packages/pie/turbo.json",
      "apps/desktop/turbo.json",
    ]) {
      const turbo = readJson(relative);
      const build = turbo.tasks.build as Record<string, unknown>;
      expect(build.cache).not.toBe(false);
      expect(build.env).toEqual(["PIE_DAEMON_COMPATIBILITY_KEY"]);
    }
  });

  it("keeps the five Code check gates and injects the daemon key before turbo", () => {
    const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/quality.yml"), "utf8");
    expect(workflow).not.toMatch(/continue-on-error/);
    expect(workflow).toContain("pnpm turbo run build");
    expect(workflow).toMatch(/^ {10}pnpm test &$/m);
    expect(workflow).toContain("pnpm turbo run typecheck lint:check");
    expect(workflow).toContain("pnpm run format:check");
    expect(workflow).toContain(
      'PIE_DAEMON_COMPATIBILITY_KEY="$(node packages/core/print-daemon-compatibility-key.ts)"',
    );
    expect(workflow).not.toMatch(/--passWithNoTests/);

    const rootPackage = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(rootPackage.scripts["format:check"]).toContain("oxfmt --check");
    expect(rootPackage.scripts.test).toBe("vitest run");

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
