import assert from "node:assert/strict";
import path from "node:path";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { layer } from "@effect/vitest";
import * as Observability from "@getpie/server/observability";
import { Effect, FileSystem, Layer } from "effect";
import { describe, expect, it as test } from "vitest";

import {
  DEFAULT_DESKTOP_SETTINGS,
  assignDesktopWindow,
  decodeDesktopSettings,
  isRectVisibleOnWorkArea,
  makeDesktopStore,
  parseDesktopJson,
  placementFromWindowState,
  stringifyDesktopJson,
  windowStateFromBounds,
} from "./desktop-store";

describe("decodeDesktopSettings", () => {
  test("fills defaults for an empty document", () => {
    expect(decodeDesktopSettings(parseDesktopJson(""))).toEqual(DEFAULT_DESKTOP_SETTINGS);
  });

  test("keeps a complete desktop.window object", () => {
    expect(
      decodeDesktopSettings(
        parseDesktopJson(
          JSON.stringify({
            desktop: { window: { width: 1400, height: 900, x: 12, y: 40, maximized: true } },
          }),
        ),
      ),
    ).toEqual({
      window: { width: 1400, height: 900, x: 12, y: 40, maximized: true },
    });
  });

  test("reads leftover ui.window when desktop.window is absent", () => {
    expect(
      decodeDesktopSettings(
        parseDesktopJson(
          JSON.stringify({
            ui: { window: { width: 1400, height: 900, x: 12, y: 40, maximized: true } },
          }),
        ),
      ),
    ).toEqual({
      window: { width: 1400, height: 900, x: 12, y: 40, maximized: true },
    });
  });

  test("prefers desktop.window over leftover ui.window", () => {
    expect(
      decodeDesktopSettings(
        parseDesktopJson(
          JSON.stringify({
            desktop: { window: { width: 1400, height: 900, maximized: false } },
            ui: { window: { width: 800, height: 600, maximized: true } },
          }),
        ),
      ),
    ).toEqual({
      window: { width: 1400, height: 900, maximized: false },
    });
  });

  test("uses the default size when the stored size is below the minimum", () => {
    expect(
      decodeDesktopSettings(
        parseDesktopJson(JSON.stringify({ desktop: { window: { width: 100, height: 100 } } })),
      ),
    ).toEqual(DEFAULT_DESKTOP_SETTINGS);
  });

  test("rejects a present-but-wrong maximized value", () => {
    expect(() =>
      decodeDesktopSettings(
        parseDesktopJson(JSON.stringify({ desktop: { window: { maximized: "yes" } } })),
      ),
    ).toThrow(/boolean|maximized/i);
  });
});

describe("stringifyDesktopJson", () => {
  test("omits unset coordinates", () => {
    const document = JSON.parse(stringifyDesktopJson(DEFAULT_DESKTOP_SETTINGS));
    expect(document).toEqual({
      desktop: { window: { width: 1200, height: 800, maximized: false } },
    });
  });
});

describe("assignDesktopWindow", () => {
  test("preserves ui.theme and strips leftover ui.window", () => {
    expect(
      assignDesktopWindow(
        {
          ui: {
            theme: "dark",
            window: { width: 800, height: 600, maximized: true },
          },
          agent: { foo: 1 },
        },
        DEFAULT_DESKTOP_SETTINGS.window,
      ),
    ).toEqual({
      ui: { theme: "dark" },
      agent: { foo: 1 },
      desktop: {
        window: { width: 1200, height: 800, maximized: false },
      },
    });
  });
});

describe("placementFromWindowState", () => {
  test("drops coordinates that sit off the work area", () => {
    expect(
      placementFromWindowState(
        { width: 1200, height: 800, x: 8000, y: 8000, maximized: false },
        { x: 0, y: 0, width: 1440, height: 900 },
      ),
    ).toEqual({ width: 1200, height: 800 });
  });

  test("keeps coordinates that overlap the work area", () => {
    expect(
      placementFromWindowState(
        { width: 1200, height: 800, x: 80, y: 40, maximized: false },
        { x: 0, y: 0, width: 1440, height: 900 },
      ),
    ).toEqual({ width: 1200, height: 800, x: 80, y: 40 });
  });
});

describe("isRectVisibleOnWorkArea", () => {
  test("rejects a sliver of overlap", () => {
    expect(
      isRectVisibleOnWorkArea(
        { x: 1400, y: 0, width: 1200, height: 800 },
        { x: 0, y: 0, width: 1440, height: 900 },
      ),
    ).toBe(false);
  });
});

describe("windowStateFromBounds", () => {
  test("rounds and floors to the minimum size", () => {
    expect(windowStateFromBounds({ x: 1.6, y: 2.2, width: 10, height: 10 }, true)).toEqual({
      width: 800,
      height: 600,
      x: 2,
      y: 2,
      maximized: true,
    });
  });
});

const platform = Layer.mergeAll(NodeFileSystem.layer, Observability.discard);

layer(platform)("makeDesktopStore", (it) => {
  it.effect("returns defaults without creating config.json", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "pie-desktop-store-" });
      const store = yield* makeDesktopStore(path.join(home, "config.json"));
      const loaded = yield* store.get;
      assert.deepEqual(loaded, DEFAULT_DESKTOP_SETTINGS);
      assert.equal(yield* fs.exists(path.join(home, "config.json")), false);
    }),
  );

  it.effect("writes desktop.window on the first window save and reads it back", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "pie-desktop-store-" });
      const file = path.join(home, "config.json");
      const store = yield* makeDesktopStore(file);
      const window = { width: 1400, height: 900, x: 24, y: 48, maximized: false };
      yield* store.setWindow(window);
      assert.deepEqual(JSON.parse(yield* fs.readFileString(file)), {
        desktop: { window },
      });
      assert.deepEqual((yield* store.get).window, window);
    }),
  );

  it.effect("leaves ui.theme in place when saving the window", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "pie-desktop-store-" });
      const file = path.join(home, "config.json");
      yield* fs.writeFileString(file, JSON.stringify({ ui: { theme: "dark" } }));
      const store = yield* makeDesktopStore(file);
      yield* store.setWindow({ width: 1400, height: 900, maximized: false });
      assert.deepEqual(JSON.parse(yield* fs.readFileString(file)), {
        ui: { theme: "dark" },
        desktop: { window: { width: 1400, height: 900, maximized: false } },
      });
    }),
  );

  it.effect("relocates leftover ui.window on the next window save", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "pie-desktop-store-" });
      const file = path.join(home, "config.json");
      yield* fs.writeFileString(
        file,
        JSON.stringify({
          ui: { theme: "dark", window: { width: 1000, height: 700, maximized: false } },
        }),
      );
      const store = yield* makeDesktopStore(file);
      yield* store.setWindow({ width: 1400, height: 900, maximized: false });
      assert.deepEqual(JSON.parse(yield* fs.readFileString(file)), {
        ui: { theme: "dark" },
        desktop: { window: { width: 1400, height: 900, maximized: false } },
      });
    }),
  );

  it.effect("uses defaults when the file is corrupt instead of blocking", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "pie-desktop-store-" });
      const file = path.join(home, "config.json");
      yield* fs.writeFileString(file, "{");
      const store = yield* makeDesktopStore(file);
      assert.deepEqual(yield* store.get, DEFAULT_DESKTOP_SETTINGS);
      assert.equal(yield* fs.readFileString(file), "{");
    }),
  );
});
