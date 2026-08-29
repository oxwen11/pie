import { writeFileAtomic } from "@getpie/effect-json-store";
import { Effect, FileSystem, Schema } from "effect";
import { parse, stringify } from "smol-toml";

/** Matches BrowserWindow `minWidth` / `minHeight` in `main-window.ts`. */
export const MIN_WINDOW_WIDTH = 800;
export const MIN_WINDOW_HEIGHT = 600;
export const DEFAULT_WINDOW_WIDTH = 1200;
export const DEFAULT_WINDOW_HEIGHT = 800;

/** Owner-only, matching `$PIE_HOME/config.toml`. */
export const DESKTOP_CONFIG_FILE_MODE = 0o600;

/** Keep in sync with `SETTINGS_FILE_HEADER` in `packages/server/src/settings/codec.ts`. */
export const DESKTOP_CONFIG_FILE_HEADER = `# pie settings. Edit this file or use the Settings page.
# Saving rewrites the file and does not keep comments.

`;

export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export const DesktopWindowStateSchema = Schema.Struct({
  width: Schema.Number,
  height: Schema.Number,
  x: Schema.optionalKey(Schema.Number),
  y: Schema.optionalKey(Schema.Number),
  maximized: Schema.Boolean,
});
export type DesktopWindowState = typeof DesktopWindowStateSchema.Type;

export const DesktopSettingsSchema = Schema.Struct({
  window: DesktopWindowStateSchema,
});
export type DesktopSettings = typeof DesktopSettingsSchema.Type;

export const DEFAULT_WINDOW_STATE: DesktopWindowState = {
  width: DEFAULT_WINDOW_WIDTH,
  height: DEFAULT_WINDOW_HEIGHT,
  maximized: false,
};

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  window: DEFAULT_WINDOW_STATE,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

type OverlayWindow = {
  width: unknown;
  height: unknown;
  x?: unknown;
  y?: unknown;
  maximized: unknown;
};

function overlayWindowDefaults(raw: unknown) {
  if (!isRecord(raw)) return raw;
  if (raw.ui !== undefined && !isRecord(raw.ui)) return raw;
  const ui = isRecord(raw.ui) ? raw.ui : {};
  if (ui.window !== undefined && !isRecord(ui.window)) return raw;
  const window = isRecord(ui.window) ? ui.window : {};

  const overlaySize = (key: "width" | "height", fallback: number, min: number) => {
    if (!(key in window)) return fallback;
    const value = window[key];
    if (isFiniteNumber(value) && value >= min) return value;
    if (isFiniteNumber(value)) return fallback;
    return value;
  };

  const overlaid: OverlayWindow = {
    width: overlaySize("width", DEFAULT_WINDOW_WIDTH, MIN_WINDOW_WIDTH),
    height: overlaySize("height", DEFAULT_WINDOW_HEIGHT, MIN_WINDOW_HEIGHT),
    maximized: "maximized" in window ? window.maximized : false,
  };
  if ("x" in window) overlaid.x = window.x;
  if ("y" in window) overlaid.y = window.y;
  return { window: overlaid };
}

/** Empty / whitespace-only files are an empty table, not a parse error. */
export function parseDesktopToml(text: string): unknown {
  return text.trim() === "" ? {} : parse(text);
}

export function decodeDesktopSettings(raw: unknown): DesktopSettings {
  return Schema.decodeUnknownSync(DesktopSettingsSchema)(overlayWindowDefaults(raw));
}

type TomlWindow = {
  width: number;
  height: number;
  maximized: boolean;
  x?: number;
  y?: number;
};

function windowForToml(window: DesktopWindowState): TomlWindow {
  const document: TomlWindow = {
    width: window.width,
    height: window.height,
    maximized: window.maximized,
  };
  if (window.x !== undefined) document.x = window.x;
  if (window.y !== undefined) document.y = window.y;
  return document;
}

/**
 * Overlay `ui.window` onto an existing document so sibling keys (`ui.theme`,
 * unknown tables) survive a window save.
 */
export function assignUiWindow(raw: unknown, window: DesktopWindowState): Record<string, unknown> {
  if (isRecord(raw) && raw.ui !== undefined && !isRecord(raw.ui)) {
    throw new Error("ui must be a table");
  }
  const document: Record<string, unknown> = isRecord(raw) ? { ...raw } : {};
  const ui: Record<string, unknown> = isRecord(document.ui) ? { ...document.ui } : {};
  ui.window = windowForToml(window);
  document.ui = ui;
  return document;
}

export function stringifyDesktopToml(settings: DesktopSettings): string {
  return stringifyConfigToml(assignUiWindow({}, settings.window));
}

function stringifyConfigToml(document: unknown): string {
  const body = stringify(document);
  const withNewline = body.endsWith("\n") ? body : `${body}\n`;
  return `${DESKTOP_CONFIG_FILE_HEADER}${withNewline}`;
}

/**
 * At least 100px of the window must overlap the work area so a restored
 * frame is actually reachable after a display layout change.
 */
export function isRectVisibleOnWorkArea(rect: Rect, workArea: Rect): boolean {
  const overlapX =
    Math.min(rect.x + rect.width, workArea.x + workArea.width) - Math.max(rect.x, workArea.x);
  const overlapY =
    Math.min(rect.y + rect.height, workArea.y + workArea.height) - Math.max(rect.y, workArea.y);
  return overlapX > 100 && overlapY > 100;
}

export type WindowPlacement = {
  readonly width: number;
  readonly height: number;
  readonly x?: number;
  readonly y?: number;
};

export function placementFromWindowState(
  state: DesktopWindowState,
  workArea: Rect | undefined,
): WindowPlacement {
  const size: WindowPlacement = { width: state.width, height: state.height };
  if (state.x === undefined || state.y === undefined) return size;
  const rect = { x: state.x, y: state.y, width: state.width, height: state.height };
  if (workArea === undefined || !isRectVisibleOnWorkArea(rect, workArea)) return size;
  return { width: state.width, height: state.height, x: state.x, y: state.y };
}

export function windowStateFromBounds(bounds: Rect, maximized: boolean): DesktopWindowState {
  return {
    width: Math.max(MIN_WINDOW_WIDTH, Math.round(bounds.width)),
    height: Math.max(MIN_WINDOW_HEIGHT, Math.round(bounds.height)),
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    maximized,
  };
}

export type DesktopStore = {
  readonly get: Effect.Effect<DesktopSettings>;
  readonly setWindow: (window: DesktopWindowState) => Effect.Effect<void>;
};

/**
 * Read/write `$PIE_HOME/config.toml` `[ui.window]`. Methods are R-free:
 * FileSystem is bound at construction so Electron event handlers can
 * `Effect.runFork` them. A missing or corrupt file is defaults in memory
 * and is not rewritten until the next successful save — a bad file must
 * not block the window. Writes merge `ui.window` and leave sibling keys.
 */
export function makeDesktopStore(
  file: string,
): Effect.Effect<DesktopStore, never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const ctx = yield* Effect.context<FileSystem.FileSystem>();
    const fs = yield* FileSystem.FileSystem;

    const readExisting = fs
      .readFileString(file)
      .pipe(
        Effect.catch((error) =>
          error.reason._tag === "NotFound" ? Effect.succeed("") : Effect.fail(error),
        ),
      );

    const get = readExisting.pipe(
      Effect.flatMap((text) =>
        Effect.try({
          try: () => decodeDesktopSettings(parseDesktopToml(text)),
          catch: (cause) => cause,
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not read desktop host settings; using defaults", cause).pipe(
          Effect.annotateLogs({ file }),
          Effect.as(DEFAULT_DESKTOP_SETTINGS),
        ),
      ),
      Effect.provide(ctx),
    );

    const setWindow = (window: DesktopWindowState) =>
      readExisting.pipe(
        Effect.flatMap((text) =>
          Effect.try({
            try: () => stringifyConfigToml(assignUiWindow(parseDesktopToml(text), window)),
            catch: (cause) => cause,
          }),
        ),
        Effect.flatMap((body) =>
          writeFileAtomic(fs, file, body, {
            mode: DESKTOP_CONFIG_FILE_MODE,
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not write desktop host settings", cause).pipe(
            Effect.annotateLogs({ file }),
          ),
        ),
        Effect.provide(ctx),
      );

    return { get, setWindow } satisfies DesktopStore;
  });
}
