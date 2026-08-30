import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { SessionRef } from "@getpie/contract";
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  AssetNotImage,
  AssetNotReferenced,
  AssetPathNotAllowed,
  SessionImageAssets,
  SessionImageAssetsLayer,
} from "../../src/assets";
import { PiAgentSessionService } from "../../src/harness/session-service";

const ref: SessionRef = {
  projectId: "11111111-1111-4111-8111-111111111111",
  sessionId: "session-1",
};
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXkAAAAASUVORK5CYII=",
  "base64",
);
const temporaryDirectories: string[] = [];

async function makeAssets(cwd: string, markdown: string) {
  const sessions = {
    workspaceFor: () => Effect.succeed({ cwd }),
    getMessages: () =>
      Effect.succeed([
        {
          id: "message-1",
          role: "assistant" as const,
          parts: [{ type: "text" as const, text: markdown }],
        },
      ]),
  };
  const layer = SessionImageAssetsLayer.pipe(
    Layer.provide(Layer.succeed(PiAgentSessionService, sessions as never)),
  );
  return Effect.runPromise(SessionImageAssets.pipe(Effect.provide(layer)));
}

async function makeWorkspace(): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pie-assets-test-"));
  temporaryDirectories.push(cwd);
  return cwd;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => fs.rm(dir, { recursive: true })));
});

describe("SessionImageAssets", () => {
  it("serves exact referenced raster bytes and rejects a tampered capability", async () => {
    const cwd = await makeWorkspace();
    await fs.writeFile(path.join(cwd, "image.png"), PNG_1X1);
    const assets = await makeAssets(cwd, "![Result](image.png)");

    const created = await Effect.runPromise(assets.createUrl(ref, "image.png"));
    const token = created.relativeUrl.split("/")[3];
    expect(token).toBeDefined();
    const content = await Effect.runPromise(assets.contentForToken(token!));

    expect(content?.mediaType).toBe("image/png");
    expect(content?.bytes).toEqual(new Uint8Array(PNG_1X1));
    await expect(Effect.runPromise(assets.contentForToken(`${token}x`))).resolves.toBeNull();
  });

  it("does not authorize a path mentioned only inside code", async () => {
    const cwd = await makeWorkspace();
    await fs.writeFile(path.join(cwd, "image.png"), PNG_1X1);
    const assets = await makeAssets(cwd, "`![Result](image.png)`");

    await expect(Effect.runPromise(assets.createUrl(ref, "image.png"))).rejects.toBeInstanceOf(
      AssetNotReferenced,
    );
  });

  it.skipIf(process.platform === "win32")(
    "rejects a referenced symlink whose target escapes the allowed roots",
    async () => {
      const cwd = await fs.mkdtemp(path.join(os.homedir(), ".pie-assets-workspace-"));
      const outside = await fs.mkdtemp(path.join(os.homedir(), ".pie-assets-outside-"));
      temporaryDirectories.push(cwd, outside);
      await fs.writeFile(path.join(outside, "outside.png"), PNG_1X1);
      await fs.symlink(path.join(outside, "outside.png"), path.join(cwd, "image.png"));
      const assets = await makeAssets(cwd, "![Result](image.png)");

      await expect(Effect.runPromise(assets.createUrl(ref, "image.png"))).rejects.toBeInstanceOf(
        AssetPathNotAllowed,
      );
    },
  );

  it("rejects non-raster content even when the extension is an allowed image type", async () => {
    const cwd = await makeWorkspace();
    await fs.writeFile(path.join(cwd, "image.png"), "<svg></svg>");
    const assets = await makeAssets(cwd, "![Result](image.png)");

    await expect(Effect.runPromise(assets.createUrl(ref, "image.png"))).rejects.toBeInstanceOf(
      AssetNotImage,
    );
  });
});
