import type { SessionRef } from "@getpie/contract";

/** One viewport observer for the entire sidebar; collapsed groups unregister their rows. */
export class VisibleSessionRows {
  private observer: IntersectionObserver | undefined;
  private readonly rows = new Map<Element, { ref: SessionRef; visible: boolean }>();

  constructor(private readonly replace: (refs: readonly SessionRef[]) => void) {}

  start(): () => void {
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const row = this.rows.get(entry.target);
        if (row)
          row.visible =
            entry.isIntersecting &&
            entry.intersectionRect.width > 0 &&
            entry.intersectionRect.height > 0;
      }
      this.publish();
    });
    for (const element of this.rows.keys()) this.observer.observe(element);
    return () => {
      this.observer?.disconnect();
      this.observer = undefined;
      for (const row of this.rows.values()) row.visible = false;
      this.publish();
    };
  }

  observe(element: Element, ref: SessionRef): () => void {
    this.rows.set(element, { ref, visible: false });
    this.observer?.observe(element);
    return () => {
      this.observer?.unobserve(element);
      this.rows.delete(element);
      this.publish();
    };
  }

  private publish(): void {
    const refs: SessionRef[] = [];
    for (const row of this.rows.values()) {
      if (row.visible) refs.push(row.ref);
    }
    this.replace(refs);
  }
}
