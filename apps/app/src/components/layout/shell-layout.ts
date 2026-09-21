import { createStore, type StoreApi } from "zustand/vanilla";

const STORAGE_NAME = "pie:shell-widths";
const SIDEBAR_MIN_PX = 192;
const SIDEBAR_MAX_PX = 480;
const SIDEBAR_DEFAULT_PX = 256;

export interface ShellLayoutState {
  readonly sidebarWidth: number;
  readonly contentBySession: Readonly<Record<string, number>>;
}

function clampSidebarWidth(px: number): number {
  return Math.min(SIDEBAR_MAX_PX, Math.max(SIDEBAR_MIN_PX, Math.round(px)));
}

function parseState(raw: string | null): ShellLayoutState {
  const empty: ShellLayoutState = { sidebarWidth: SIDEBAR_DEFAULT_PX, contentBySession: {} };
  if (raw === null) return empty;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return empty;
    const record = parsed as { sidebarWidth?: unknown; contentBySession?: unknown };
    const sidebarWidth =
      typeof record.sidebarWidth === "number" && Number.isFinite(record.sidebarWidth)
        ? clampSidebarWidth(record.sidebarWidth)
        : SIDEBAR_DEFAULT_PX;
    const contentBySession: Record<string, number> = {};
    if (typeof record.contentBySession === "object" && record.contentBySession !== null) {
      for (const [key, value] of Object.entries(record.contentBySession)) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
          contentBySession[key] = Math.round(value);
        }
      }
    }
    return { sidebarWidth, contentBySession };
  } catch {
    return empty;
  }
}

/**
 * Owns column widths for the shell: one session-list width, and one docked
 * content-panel width per session. Mirrors ContentPanel — a module-lifetime
 * store, not a React tree.
 */
export class ShellLayout {
  readonly store: StoreApi<ShellLayoutState>;

  readonly #storage: Storage | undefined;

  constructor(storage?: Storage) {
    this.#storage = storage;
    this.store = createStore(() => parseState(storage?.getItem(STORAGE_NAME) ?? null));
  }

  setSidebarWidth(px: number, persist = false): void {
    if (!Number.isFinite(px)) return;
    const next = clampSidebarWidth(px);
    if (this.store.getState().sidebarWidth !== next) this.store.setState({ sidebarWidth: next });
    if (persist) this.#save();
  }

  setContentWidth(sessionKey: string, px: number): void {
    if (!Number.isFinite(px) || px <= 0) return;
    const next = Math.round(px);
    const { contentBySession } = this.store.getState();
    if (contentBySession[sessionKey] === next) return;
    this.store.setState({ contentBySession: { ...contentBySession, [sessionKey]: next } });
    this.#save();
  }

  #save(): void {
    this.#storage?.setItem(STORAGE_NAME, JSON.stringify(this.store.getState()));
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export const shellLayout = new ShellLayout(safeLocalStorage());
