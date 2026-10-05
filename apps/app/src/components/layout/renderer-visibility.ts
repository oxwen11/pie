import type { Platform } from "@/platform";

/** One renderer lifecycle source; blur is deliberately not a visibility event. */
export class RendererVisibility {
  private visible = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly host: Platform["visibility"]) {}

  readonly getSnapshot = (): boolean => this.visible;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): () => void {
    const update = () =>
      this.set(document.visibilityState === "visible" && (this.host?.getSnapshot() ?? true));
    const hide = () => this.set(false);
    const unsubscribe = this.host?.subscribe(update);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", update);
    update();
    return () => {
      unsubscribe?.();
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", update);
      hide();
    };
  }

  private set(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    for (const listener of this.listeners) listener();
  }
}
