import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { developmentScopeForRoot } from "./development-scope";

const roots: string[] = [];

function root(...segments: string[]): string {
  const directory = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "pie-dev-scope-")),
    ...segments,
  );
  fs.mkdirSync(directory, { recursive: true });
  roots.push(directory.split(path.sep).slice(0, -segments.length).join(path.sep));
  return directory;
}

afterEach(() => {
  for (const directory of roots.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("development daemon scope", () => {
  it("distinguishes checkouts with the same basename", () => {
    const first = root("one", "pie");
    const second = root("two", "pie");
    expect(developmentScopeForRoot(first)).not.toBe(developmentScopeForRoot(second));
  });
});
