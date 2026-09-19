import type { PieClient } from "@getpie/client";
import type { SessionRef, TerminalConnectEvent } from "@getpie/contract";
import { ORPCError } from "@orpc/client";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

import { isAbortError, sleep } from "@/lib/utils";

import { subscribeToAppTheme, xtermThemeFromElement } from "./theme";

interface TerminalSurface {
  readonly detach: () => void;
}

export function attachTerminalSurface(
  mount: HTMLElement,
  options: {
    readonly client: PieClient;
    readonly ref: SessionRef;
    readonly terminalId: string;
  },
): TerminalSurface {
  const resubscribeMs = 1_000;
  const term = new Terminal({
    convertEol: true,
    cursorBlink: true,
    fontSize: 12,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    theme: xtermThemeFromElement(mount),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(mount);
  term.textarea?.setAttribute("aria-label", "zsh input");
  fit.fit();

  const abort = new AbortController();
  let attachedWriter = false;
  const dataDisposable = term.onData((data) => {
    if (!attachedWriter) return;
    void options.client.terminal
      .write({
        ref: options.ref,
        terminalId: options.terminalId,
        data,
      })
      .catch(() => undefined);
  });
  const resizeDisposable = term.onResize(({ cols, rows }) => {
    if (!attachedWriter) return;
    void options.client.terminal
      .resize({
        ref: options.ref,
        terminalId: options.terminalId,
        cols,
        rows,
      })
      .catch(() => undefined);
  });

  const observer = new ResizeObserver(() => {
    try {
      fit.fit();
    } catch {
      // Unmounted mid-frame.
    }
  });
  observer.observe(mount);
  const unwatchTheme = subscribeToAppTheme(() => {
    term.options.theme = xtermThemeFromElement(mount);
  });

  const stopAsExited = (exitCode: number | null): void => {
    attachedWriter = false;
    term.write(`\r\n[process exited${exitCode === null ? "" : ` ${exitCode}`}]\r\n`);
    abort.abort();
  };

  const applyEvent = (event: TerminalConnectEvent): void => {
    switch (event.type) {
      case "snapshot":
        attachedWriter = false;
        term.reset();
        if (event.history.length > 0) term.write(event.history);
        attachedWriter = true;
        return;
      case "output":
        term.write(event.data);
        return;
      case "exited":
        stopAsExited(event.exitCode);
    }
  };

  const run = async (): Promise<void> => {
    while (!abort.signal.aborted) {
      try {
        const cols = Math.max(1, term.cols);
        const rows = Math.max(1, term.rows);
        const stream = await options.client.terminal.connect(
          {
            ref: options.ref,
            terminalId: options.terminalId,
            cols,
            rows,
          },
          { signal: abort.signal },
        );
        for await (const event of stream) {
          const aborted = abort.signal.aborted;
          if (aborted) return;
          applyEvent(event);
          if (event.type === "exited") return;
        }
      } catch (error) {
        const aborted = abort.signal.aborted;
        if (aborted || isAbortError(error)) return;
        // Closed/tombstoned ids stay dead — retrying SESSION_NOT_ACTIVE is the
        // spam the tombstone table exists to suppress.
        if (error instanceof ORPCError && error.code === "SESSION_NOT_ACTIVE") {
          stopAsExited(null);
          return;
        }
        term.write(
          `\r\n[terminal] ${error instanceof Error ? error.message : "connection failed"}\r\n`,
        );
      }
      if (abort.signal.aborted) return;
      await sleep(resubscribeMs, abort.signal);
    }
  };
  void run();

  return {
    detach: () => {
      abort.abort();
      unwatchTheme();
      observer.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      term.dispose();
    },
  };
}
