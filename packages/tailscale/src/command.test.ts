import path from "node:path";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, FileSystem } from "effect";
import { describe, expect, it } from "vitest";

import {
  findTailscaleCommand,
  isTailscaleSpawnNotFound,
  probeTailscaleClient,
  requireTailscaleCommand,
  stderrDiagnosticOf,
  tailscaleClientMissingMessage,
  tailscaleCommandForPlatform,
  tailscaleExitUserMessage,
} from "./command";

describe("tailscale command helpers", () => {
  it("selects tailscale.exe on Windows", () => {
    expect(tailscaleCommandForPlatform("win32")).toBe("tailscale.exe");
    expect(tailscaleCommandForPlatform("linux")).toBe("tailscale");
  });

  it("explains a missing client without quoting stderr", () => {
    expect(tailscaleClientMissingMessage("tailscale.exe")).toContain("PATH");
    expect(tailscaleClientMissingMessage("tailscale")).toContain("PATH");
  });

  it("treats ENOENT and nested NotFound as a missing spawn", () => {
    expect(isTailscaleSpawnNotFound({ code: "ENOENT" })).toBe(true);
    expect(isTailscaleSpawnNotFound({ cause: { reason: "NotFound" } })).toBe(true);
    expect(isTailscaleSpawnNotFound({ code: "EACCES" })).toBe(false);
  });

  it("classifies stderr without exposing the text", () => {
    expect(stderrDiagnosticOf("handler does not exist")).toBe("no-existing-handler");
    expect(stderrDiagnosticOf("Needs login; run tailscale up")).toBe("not-logged-in");
    expect(stderrDiagnosticOf("permission denied")).toBe("permission-denied");
    expect(stderrDiagnosticOf("tskey-auth-secret-value exploded")).toBe("unknown");
    expect(stderrDiagnosticOf("")).toBeUndefined();
  });

  it("maps diagnostics to user-safe messages", () => {
    expect(tailscaleExitUserMessage("not-logged-in")).toContain("logged in");
    expect(tailscaleExitUserMessage("unknown")).toBe("Tailscale command failed.");
    expect(tailscaleExitUserMessage(undefined)).toBe("Tailscale command failed.");
  });
});

const withTmp = <A>(
  f: (dir: string) => Effect.Effect<A, unknown, FileSystem.FileSystem>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* Effect.orDie(fs.makeTempDirectoryScoped());
      return yield* f(dir);
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
  );

describe("findTailscaleCommand", () => {
  it("resolves tailscale on PATH and ignores installs outside PATH", async () => {
    const result = await withTmp((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const onPath = path.join(dir, "bin");
        const offPath = path.join(dir, "hidden");
        yield* fs.makeDirectory(onPath, { recursive: true });
        yield* fs.makeDirectory(offPath, { recursive: true });
        const visible = path.join(onPath, "tailscale");
        const hidden = path.join(offPath, "tailscale");
        yield* fs.writeFileString(visible, "#!/bin/sh\n");
        yield* fs.writeFileString(hidden, "#!/bin/sh\n");
        yield* fs.chmod(visible, 0o755);
        yield* fs.chmod(hidden, 0o755);
        return {
          found: yield* findTailscaleCommand({ env: { PATH: onPath }, platform: "linux" }),
          expected: visible,
        };
      }),
    );
    expect(result.found).toBe(result.expected);
  });

  it("reports missing when PATH has no tailscale binary", async () => {
    const result = await withTmp((dir) =>
      Effect.gen(function* () {
        const empty = path.join(dir, "empty");
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(empty, { recursive: true });
        const missing = yield* findTailscaleCommand({ env: { PATH: empty }, platform: "linux" });
        const requiredTag = yield* requireTailscaleCommand({
          env: { PATH: empty },
          platform: "linux",
        }).pipe(Effect.match({ onFailure: (error) => error._tag, onSuccess: () => "available" }));
        const probed = yield* probeTailscaleClient({ env: { PATH: empty }, platform: "linux" });
        return { missing, requiredTag, probed };
      }),
    );
    expect(result.missing).toBeUndefined();
    expect(result.probed).toEqual({
      available: false,
      message: tailscaleClientMissingMessage("tailscale"),
    });
    expect(result.requiredTag).toBe("TailscaleClientMissingError");
  });
});
