import fs from "node:fs";
import module from "node:module";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const { assertFffIsland, copyFffIslandIntoApp, fffEntry, packedFffIsland, packResourcesDir } =
  module.createRequire(import.meta.url)("./fff-island.cjs") as {
    assertFffIsland: (root: string, label: string) => void;
    copyFffIslandIntoApp: (
      context: {
        appOutDir: string;
        electronPlatformName: string;
        packager: { appInfo: { productFilename: string } };
      },
      source?: string,
    ) => void;
    fffEntry: (root: string) => string;
    packedFffIsland: (context: {
      appOutDir: string;
      electronPlatformName: string;
      packager: { appInfo: { productFilename: string } };
    }) => string;
    packResourcesDir: (context: {
      appOutDir: string;
      electronPlatformName: string;
      packager: { appInfo: { productFilename: string } };
    }) => string;
  };

const writeIsland = (root: string) => {
  const entry = fffEntry(root);
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, "export default function fff() {}\n");
};

describe("packaged fff island", () => {
  it("places the island next to unpacked pie-pi-process on macOS", () => {
    expect(
      packedFffIsland({
        appOutDir: "/out",
        electronPlatformName: "darwin",
        packager: { appInfo: { productFilename: "Pie" } },
      }),
    ).toBe(
      "/out/Pie.app/Contents/Resources/app.asar.unpacked/node_modules/@getpie/server/dist/fff",
    );
  });

  it("places the island next to unpacked pie-pi-process on Linux/Windows", () => {
    expect(
      packedFffIsland({
        appOutDir: "/out",
        electronPlatformName: "linux",
        packager: { appInfo: { productFilename: "Pie" } },
      }),
    ).toBe("/out/resources/app.asar.unpacked/node_modules/@getpie/server/dist/fff");
  });

  it("copies the island beside unpacked pie-pi-process and fails closed when it is missing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-pack-"));
    const source = path.join(tmp, "fff");
    writeIsland(source);
    const context = {
      appOutDir: path.join(tmp, "out"),
      electronPlatformName: "darwin" as const,
      packager: { appInfo: { productFilename: "Pie" } },
    };
    fs.mkdirSync(packResourcesDir(context), { recursive: true });

    copyFffIslandIntoApp(context, source);
    expect(fs.existsSync(fffEntry(packedFffIsland(context)))).toBe(true);

    expect(() => assertFffIsland(path.join(tmp, "missing"), "test")).toThrow(
      /test missing bundled fff island/,
    );
  });
});
