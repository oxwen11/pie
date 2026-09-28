import type { SessionRef } from "@getpie/contract";
import type {
  PullRequestDemandInput,
  PullRequestDemandOutput,
} from "@getpie/contract/pull-request";
import { ORPCError } from "@orpc/client";

const demandKey = (ref: SessionRef): string => `${ref.projectId}\0${ref.sessionId}`;

const RENEW_MS = 30_000;

/** A renderer/connection lease. Owns demand only; PR data stays in Query. */
export class PullRequestDemand {
  private readonly sources = new Map<symbol, readonly SessionRef[]>();
  private visible = false;
  private lease: PullRequestDemandOutput | undefined;
  private version = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private pending = false;
  private scheduled = false;
  private desiredKey = "[]";

  constructor(
    private readonly send: (input: PullRequestDemandInput) => Promise<PullRequestDemandOutput>,
  ) {}

  replace(source: symbol, refs: readonly SessionRef[]): void {
    if (refs.length === 0) this.sources.delete(source);
    else this.sources.set(source, refs);
    this.changed();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.changed();
  }

  readonly reconnect = (): void => this.enqueue();

  private desired(): SessionRef[] {
    if (!this.visible) return [];
    const refs = new Map<string, SessionRef>();
    for (const source of this.sources.values()) {
      for (const ref of source) refs.set(demandKey(ref), ref);
    }
    return [...refs.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 100)
      .map(([, ref]) => ref);
  }

  private changed(): void {
    const key = JSON.stringify(this.desired());
    if (key === this.desiredKey) return;
    this.desiredKey = key;
    this.clearTimer();
    this.enqueue();
  }

  private clearTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private enqueue(): void {
    this.pending = true;
    if (this.running || this.scheduled) return;
    this.scheduled = true;
    // All row intersections from one observer delivery become one replacement.
    queueMicrotask(() => {
      this.scheduled = false;
      void this.flush();
    });
  }

  private async flush(): Promise<void> {
    this.running = true;
    this.clearTimer();
    try {
      await this.drain();
    } finally {
      this.running = false;
    }
    if (this.pending) {
      this.enqueue();
      return;
    }
    if (this.desired().length > 0) this.timer = setTimeout(() => this.enqueue(), RENEW_MS);
  }

  /** One lease write, then the next queued replacement. Ordered; not parallel. */
  private async drain(): Promise<void> {
    if (!this.pending) return;
    this.pending = false;
    const refs = this.desired();
    if (this.lease && Date.parse(this.lease.expiresAt) <= Date.now()) this.lease = undefined;
    if (!(refs.length === 0 && !this.lease)) {
      const leaseId = this.lease?.leaseId;
      try {
        const result = await this.send({
          ...(leaseId ? { leaseId } : undefined),
          version: ++this.version,
          refs,
        });
        this.lease = refs.length === 0 ? undefined : result;
      } catch (error) {
        if (error instanceof ORPCError && error.code === "INVALID_LEASE") {
          this.lease = undefined;
          // A rejected capability is never reused; recheck visibility before acquiring.
          if (leaseId && this.desired().length > 0) this.pending = true;
        }
        // Network failure uses the one renewal timer. A hidden renderer has
        // no retry loop; the server expires an unreachable lease after 90s.
      }
    }
    await this.drain();
  }
}
