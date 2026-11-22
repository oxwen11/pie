/**
 * Vendored from @earendil-works/pi-coding-agent v1.6.0
 * (`packages/coding-agent/src/modes/rpc/rpc-mode.ts`).
 *
 * Pie owns this loop so extension bind (`session.bindExtensions`), the RPC
 * UI context, and JSONL stay customizable. AgentSession still comes from the
 * npm package. Loading (which factories/paths) is `entry.ts`, not here.
 */

import crypto from "node:crypto";

import {
  initTheme,
  killTrackedDetachedChildren,
  Theme,
  type AgentSessionRuntime,
  type ExtensionUIContext,
  type ExtensionUIDialogOptions,
  type ExtensionWidgetOptions,
  type WorkingIndicatorOptions,
} from "@earendil-works/pi-coding-agent";

import { toJsonEvent } from "./json-event";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl";
import {
  flushRawStdout,
  takeOverStdout,
  waitForRawStdoutBackpressure,
  writeRawStdout,
} from "./output-guard";
import type {
  RpcCommand,
  RpcExtensionUIResponse,
  RpcResponse,
  RpcSessionState,
  RpcSlashCommand,
} from "./rpc-types";

// Re-export types for consumers
export type {
  RpcCommand,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  RpcResponse,
  RpcSessionState,
} from "./rpc-types";

/** Thrown after stdin is paused so the child can set `process.exitCode` and drain. */
export class RpcChildExitError extends Error {
  readonly exitCode: number;
  constructor(exitCode: number) {
    super(`rpc child exit ${String(exitCode)}`);
    this.name = "RpcChildExitError";
    this.exitCode = exitCode;
  }
}

/**
 * Run in RPC mode.
 * Listens for JSON commands on stdin, outputs events and responses on stdout.
 */
export async function runRpcMode(runtimeHost: AgentSessionRuntime): Promise<never> {
  takeOverStdout();
  let session = runtimeHost.session;
  let unsubscribe: (() => void) | undefined;
  let unsubscribeBackpressure: (() => void) | undefined;

  const output = (frame: unknown) => {
    writeRawStdout(serializeJsonLine(frame));
  };

  const success = (
    id: string | undefined,
    command: RpcCommand["type"],
    data?: unknown,
  ): RpcResponse => {
    if (data === undefined) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- command is RpcCommand["type"]; union is not correlated
      return { id, type: "response", command, success: true } as RpcResponse;
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- command is RpcCommand["type"]; union is not correlated
    return { id, type: "response", command, success: true, data } as RpcResponse;
  };

  const error = (id: string | undefined, command: string, message: string): RpcResponse => {
    return { id, type: "response", command, success: false, error: message };
  };

  // Pending extension UI requests waiting for response
  const pendingExtensionRequests = new Map<
    string,
    { resolve: (value: RpcExtensionUIResponse) => void; reject: (error: Error) => void }
  >();

  // Startup bind runs before stdin is read, so no host can answer a dialog yet.
  let acceptingUiResponses = false;

  // Extension shutdown requests (ctx.shutdown()) wait until input is attached, no command is
  // being handled, and the session is idle. See checkShutdownRequested().
  let shutdownRequested = false;
  let shuttingDown = false;
  let inputReady = false;
  let activeCommands = 0;
  // SIGTERM/SIGHUP received so far. Only a repeated signal forces exit during shutdown.
  let signalCount = 0;
  const signalCleanupHandlers: Array<() => void> = [];
  let rejectKeepAlive: ((error: Error) => void) | undefined;
  const keepAlive = new Promise<never>((_resolve, reject) => {
    rejectKeepAlive = reject;
  });

  const exitRpcMode = (exitCode: number): void => {
    for (const cleanup of signalCleanupHandlers) {
      cleanup();
    }
    signalCleanupHandlers.length = 0;
    rejectKeepAlive?.(new RpcChildExitError(exitCode));
  };

  /** Helper for dialog methods with signal/timeout support */
  function createDialogPromise<T>(
    opts: ExtensionUIDialogOptions | undefined,
    defaultValue: T,
    request: Record<string, unknown>,
    parseResponse: (response: RpcExtensionUIResponse) => T,
  ): Promise<T> {
    if (opts?.signal?.aborted) return Promise.resolve(defaultValue);
    // Decline instead of waiting on a reply that can never arrive.
    if (!acceptingUiResponses) return Promise.resolve(defaultValue);

    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        opts?.signal?.removeEventListener("abort", onAbort);
        pendingExtensionRequests.delete(id);
      };

      const onAbort = () => {
        cleanup();
        resolve(defaultValue);
      };
      opts?.signal?.addEventListener("abort", onAbort, { once: true });

      if (opts?.timeout) {
        timeoutId = setTimeout(() => {
          cleanup();
          resolve(defaultValue);
        }, opts.timeout);
      }

      pendingExtensionRequests.set(id, {
        resolve: (response: RpcExtensionUIResponse) => {
          cleanup();
          resolve(parseResponse(response));
        },
        reject,
      });
      output({ type: "extension_ui_request", id, ...request });
    });
  }

  /**
   * Create an extension UI context that uses the RPC protocol.
   */
  const createExtensionUIContext = (): ExtensionUIContext => ({
    select: (title, options, opts) =>
      createDialogPromise(
        opts,
        undefined,
        { method: "select", title, options, timeout: opts?.timeout },
        (r) => ("cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined),
      ),

    confirm: (title, message, opts) =>
      createDialogPromise(
        opts,
        false,
        { method: "confirm", title, message, timeout: opts?.timeout },
        (r) => ("cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false),
      ),

    input: (title, placeholder, opts) =>
      createDialogPromise(
        opts,
        undefined,
        { method: "input", title, placeholder, timeout: opts?.timeout },
        (r) => ("cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined),
      ),

    notify(message: string, type?: "info" | "warning" | "error"): void {
      // Fire and forget - no response needed
      output({
        type: "extension_ui_request",
        id: crypto.randomUUID(),
        method: "notify",
        message,
        notifyType: type,
      });
    },

    onTerminalInput(): () => void {
      // Raw terminal input not supported in RPC mode
      return () => {
        /* RPC mode has no raw terminal input stream to detach */
      };
    },

    setStatus(key: string, text: string | undefined): void {
      // Fire and forget - no response needed
      output({
        type: "extension_ui_request",
        id: crypto.randomUUID(),
        method: "setStatus",
        statusKey: key,
        statusText: text,
      });
    },

    setWorkingMessage(_message?: string): void {
      // Working message not supported in RPC mode - requires TUI loader access
    },

    setWorkingVisible(_visible: boolean): void {
      // Working visibility not supported in RPC mode - requires TUI loader access
    },

    setWorkingIndicator(_options?: WorkingIndicatorOptions): void {
      // Working indicator customization not supported in RPC mode - requires TUI loader access
    },

    setHiddenThinkingLabel(_label?: string): void {
      // Hidden thinking label not supported in RPC mode - requires TUI message rendering access
    },

    setWidget(key: string, content: unknown, options?: ExtensionWidgetOptions): void {
      // Only support string arrays in RPC mode - factory functions are ignored
      if (content === undefined || Array.isArray(content)) {
        output({
          type: "extension_ui_request",
          id: crypto.randomUUID(),
          method: "setWidget",
          widgetKey: key,
          widgetLines: content as string[] | undefined,
          widgetPlacement: options?.placement,
        });
      }
      // Component factories are not supported in RPC mode - would need TUI access
    },

    setFooter(_factory: unknown): void {
      // Custom footer not supported in RPC mode - requires TUI access
    },

    setHeader(_factory: unknown): void {
      // Custom header not supported in RPC mode - requires TUI access
    },

    setTitle(title: string): void {
      // Fire and forget - host can implement terminal title control
      output({
        type: "extension_ui_request",
        id: crypto.randomUUID(),
        method: "setTitle",
        title,
      });
    },

    async custom() {
      // Custom UI not supported in RPC mode
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ExtensionUIContext.custom is typed Promise<T>
      return undefined as never;
    },

    pasteToEditor(text: string): void {
      // Paste handling not supported in RPC mode - falls back to setEditorText
      this.setEditorText(text);
    },

    setEditorText(text: string): void {
      // Fire and forget - host can implement editor control
      output({
        type: "extension_ui_request",
        id: crypto.randomUUID(),
        method: "set_editor_text",
        text,
      });
    },

    getEditorText(): string {
      // Synchronous method can't wait for RPC response
      // Host should track editor state locally if needed
      return "";
    },

    editor: (title: string, prefill?: string): Promise<string | undefined> =>
      createDialogPromise(undefined, undefined, { method: "editor", title, prefill }, (r) =>
        "cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined,
      ),

    addAutocompleteProvider(): void {
      // Autocomplete provider composition is not supported in RPC mode
    },

    setEditorComponent(): void {
      // Custom editor components not supported in RPC mode
    },

    getEditorComponent() {
      // Custom editor components not supported in RPC mode
      return undefined;
    },

    get theme(): Theme {
      const key = Symbol.for("@earendil-works/pi-coding-agent:theme");
      const store = globalThis as Record<symbol, Theme | undefined>;
      if (!(store[key] instanceof Theme)) {
        initTheme();
      }
      const current = store[key];
      if (!(current instanceof Theme)) {
        throw new Error("Theme not initialized. Call initTheme() first.");
      }
      return current;
    },

    getAllThemes() {
      return [];
    },

    getTheme(_name: string) {
      return undefined;
    },

    setTheme(_theme: string | Theme) {
      // Theme switching not supported in RPC mode
      return { success: false, error: "Theme switching not supported in RPC mode" };
    },

    getToolsExpanded() {
      // Tool expansion not supported in RPC mode - no TUI
      return false;
    },

    setToolsExpanded(_expanded: boolean) {
      // Tool expansion not supported in RPC mode - no TUI
    },
  });

  runtimeHost.setRebindSession(async () => {
    await rebindSession();
    // stderr, never stdout: stdout carries the RPC protocol.
    for (const diagnostic of runtimeHost.takeUnreportedDiagnostics()) {
      console.error(`${diagnostic.type}: ${diagnostic.message}`);
    }
  });

  const rebindSession = async (): Promise<void> => {
    session = runtimeHost.session;
    // Subscribe before binding so events emitted by session_start handlers (e.g. appended entries) reach the client.
    unsubscribe?.();
    unsubscribeBackpressure?.();
    unsubscribe = session.subscribe((event) => {
      output(toJsonEvent(event));
      if (event.type === "agent_settled") {
        checkShutdownRequested();
      }
    });
    unsubscribeBackpressure = session.agent.subscribe(async () => {
      await waitForRawStdoutBackpressure();
    });

    await session.bindExtensions({
      uiContext: createExtensionUIContext(),
      mode: "rpc",
      commandContextActions: {
        waitForIdle: () => session.waitForIdle(),
        newSession: async (options) => runtimeHost.newSession(options),
        fork: async (entryId, forkOptions) => {
          const result = await runtimeHost.fork(entryId, forkOptions);
          return { cancelled: result.cancelled };
        },
        navigateTree: async (targetId, options) => {
          const result = await session.navigateTree(targetId, {
            summarize: options?.summarize,
            customInstructions: options?.customInstructions,
            replaceInstructions: options?.replaceInstructions,
            label: options?.label,
          });
          return { cancelled: result.cancelled };
        },
        switchSession: async (sessionPath, options) => {
          return runtimeHost.switchSession(sessionPath, options);
        },
        reload: async () => {
          await session.reload();
        },
      },
      shutdownHandler: () => {
        shutdownRequested = true;
        // An idle session has no command response or agent_settled left to check the flag.
        // Check on the next tick so the requesting handler finishes first.
        setImmediate(checkShutdownRequested);
      },
      onError: (err) => {
        output({
          type: "extension_error",
          extensionPath: err.extensionPath,
          event: err.event,
          error: err.error,
        });
      },
    });
  };

  const handleSignal = (signal: NodeJS.Signals): void => {
    const exitCode = signal === "SIGHUP" ? 129 : 143;
    signalCount++;
    killTrackedDetachedChildren();
    if (!shuttingDown) {
      void shutdown(exitCode, signal);
    } else if (signalCount > 1) {
      // Process managers often close stdin and send SIGTERM together, so one signal
      // during shutdown is not a request to skip cleanup; a repeated one is.
      detachInput();
      process.stdin.pause();
      exitRpcMode(exitCode);
    }
  };

  const registerSignal = (signal: NodeJS.Signals): void => {
    // Handlers stay registered until exit: without one, a signal during shutdown would kill
    // the process before dispose() finishes (for example a pending MCP token refresh).
    const handler = () => {
      handleSignal(signal);
    };
    process.on(signal, handler);
    signalCleanupHandlers.push(() => process.off(signal, handler));
  };

  const registerSignalHandlers = (): void => {
    const signals: NodeJS.Signals[] = ["SIGTERM"];
    if (process.platform !== "win32") {
      signals.push("SIGHUP");
    }

    for (const signal of signals) {
      registerSignal(signal);
    }
  };

  await rebindSession();
  registerSignalHandlers();

  // Handle a single command
  const handleCommand = async (command: RpcCommand): Promise<RpcResponse | undefined> => {
    const id = command.id;

    switch (command.type) {
      // =================================================================
      // Prompting
      // =================================================================

      case "prompt": {
        // Start prompt handling immediately, but emit the authoritative response only after
        // prompt preflight succeeds. Queued and immediately handled prompts also count as success.
        let preflightSucceeded = false;
        // Extension commands run inside prompt(); defer shutdown requests until it settles.
        activeCommands++;
        void session
          .prompt(command.message, {
            images: command.images,
            streamingBehavior: command.streamingBehavior,
            source: "rpc",
            preflightResult: (disposition) => {
              preflightSucceeded = true;
              // 0.99 reports disposition instead of a boolean. isStreaming is
              // already true for a prompt that just started, so it cannot mean
              // "queued". "handled" (an extension command consumed the input)
              // starts no turn, so it is forwarded for the host to tell apart.
              output(
                success(id, "prompt", {
                  started: disposition === "started",
                  disposition,
                }),
              );
            },
          })
          .catch((cause: unknown) => {
            if (!preflightSucceeded) {
              const message = cause instanceof Error ? cause.message : String(cause);
              output(error(id, "prompt", message));
            }
          })
          .finally(() => {
            activeCommands--;
            checkShutdownRequested();
          });
        return undefined;
      }

      case "steer": {
        const disposition = await session.steer(command.message, command.images, { source: "rpc" });
        return success(id, "steer", { disposition });
      }

      case "follow_up": {
        const disposition = await session.followUp(command.message, command.images, {
          source: "rpc",
        });
        return success(id, "follow_up", { disposition });
      }

      case "abort": {
        await session.abort();
        return success(id, "abort");
      }

      case "clear_queue": {
        return success(id, "clear_queue", session.clearQueue());
      }

      case "new_session": {
        const options = command.parentSession
          ? { parentSession: command.parentSession }
          : undefined;
        const result = await runtimeHost.newSession(options);
        return success(id, "new_session", result);
      }

      // =================================================================
      // State
      // =================================================================

      case "get_state": {
        const state: RpcSessionState = {
          model: session.model,
          thinkingLevel: session.thinkingLevel,
          isStreaming: session.isStreaming,
          isCompacting: session.isCompacting,
          steeringMode: session.steeringMode,
          followUpMode: session.followUpMode,
          sessionFile: session.sessionFile,
          sessionId: session.sessionId,
          sessionName: session.sessionName,
          autoCompactionEnabled: session.autoCompactionEnabled,
          messageCount: session.messages.length,
          pendingMessageCount: session.pendingMessageCount,
        };
        return success(id, "get_state", state);
      }

      // =================================================================
      // Model
      // =================================================================

      case "set_model": {
        const models = session.modelRuntime.getAvailableSnapshot();
        const model = models.find(
          (m) => m.provider === command.provider && m.id === command.modelId,
        );
        if (!model) {
          return error(id, "set_model", `Model not found: ${command.provider}/${command.modelId}`);
        }
        await session.setModel(model);
        return success(id, "set_model", model);
      }

      case "cycle_model": {
        const result = await session.cycleModel();
        if (!result) {
          return success(id, "cycle_model", null);
        }
        return success(id, "cycle_model", result);
      }

      case "get_available_models": {
        const models = session.modelRuntime.getAvailableSnapshot();
        return success(id, "get_available_models", { models });
      }

      // =================================================================
      // Thinking
      // =================================================================

      case "set_thinking_level": {
        session.setThinkingLevel(command.level);
        return success(id, "set_thinking_level");
      }

      case "cycle_thinking_level": {
        const level = session.cycleThinkingLevel();
        if (!level) {
          return success(id, "cycle_thinking_level", null);
        }
        return success(id, "cycle_thinking_level", { level });
      }

      case "get_available_thinking_levels": {
        const levels = session.getAvailableThinkingLevels();
        return success(id, "get_available_thinking_levels", { levels });
      }

      // =================================================================
      // Queue Modes
      // =================================================================

      case "set_steering_mode": {
        session.setSteeringMode(command.mode);
        return success(id, "set_steering_mode");
      }

      case "set_follow_up_mode": {
        session.setFollowUpMode(command.mode);
        return success(id, "set_follow_up_mode");
      }

      // =================================================================
      // Compaction
      // =================================================================

      case "compact": {
        const result = await session.compact(command.customInstructions);
        return success(id, "compact", result);
      }

      case "set_auto_compaction": {
        session.setAutoCompactionEnabled(command.enabled);
        return success(id, "set_auto_compaction");
      }

      // =================================================================
      // Reload
      // =================================================================

      case "reload": {
        // Mirrors the TUI's /reload guards: rebuilding the runtime under a
        // live turn would yank tools out from under the in-flight request.
        if (session.isStreaming) {
          return error(id, "reload", "Wait for the current response to finish before reloading.");
        }
        if (session.isCompacting) {
          return error(id, "reload", "Wait for compaction to finish before reloading.");
        }
        await session.reload();
        return success(id, "reload");
      }

      // =================================================================
      // Retry
      // =================================================================

      case "set_auto_retry": {
        session.setAutoRetryEnabled(command.enabled);
        return success(id, "set_auto_retry");
      }

      case "abort_retry": {
        session.abortRetry();
        return success(id, "abort_retry");
      }

      // =================================================================
      // Bash
      // =================================================================

      case "bash": {
        const eventResult = await session.extensionRunner.emitUserBash({
          type: "user_bash",
          command: command.command,
          excludeFromContext: command.excludeFromContext ?? false,
          cwd: session.sessionManager.getCwd(),
        });

        if (eventResult?.result) {
          session.recordBashResult(command.command, eventResult.result, {
            excludeFromContext: command.excludeFromContext,
          });
          return success(id, "bash", eventResult.result);
        }

        const result = await session.executeBash(command.command, undefined, {
          excludeFromContext: command.excludeFromContext,
          id,
          operations: eventResult?.operations,
        });
        return success(id, "bash", result);
      }

      case "abort_bash": {
        session.abortBash();
        return success(id, "abort_bash");
      }

      // =================================================================
      // Session
      // =================================================================

      case "get_session_stats": {
        const stats = session.getSessionStats();
        return success(id, "get_session_stats", stats);
      }

      case "export_html": {
        const path = await session.exportToHtml(command.outputPath);
        return success(id, "export_html", { path });
      }

      case "switch_session": {
        const result = await runtimeHost.switchSession(command.sessionPath);
        return success(id, "switch_session", result);
      }

      case "fork": {
        const result = await runtimeHost.fork(command.entryId);
        return success(id, "fork", { text: result.selectedText, cancelled: result.cancelled });
      }

      case "clone": {
        const leafId = session.sessionManager.getLeafId();
        if (!leafId) {
          return error(id, "clone", "Cannot clone session: no current entry selected");
        }
        const result = await runtimeHost.fork(leafId, { position: "at" });
        return success(id, "clone", { cancelled: result.cancelled });
      }

      case "get_fork_messages": {
        const messages = session.getUserMessagesForForking();
        return success(id, "get_fork_messages", { messages });
      }

      case "get_entries": {
        const sessionManager = session.sessionManager;
        let entries = sessionManager.getEntries();
        if (command.since !== undefined) {
          const sinceIndex = entries.findIndex((e) => e.id === command.since);
          if (sinceIndex === -1) {
            return error(id, "get_entries", `Entry not found: ${command.since}`);
          }
          entries = entries.slice(sinceIndex + 1);
        }
        return success(id, "get_entries", { entries, leafId: sessionManager.getLeafId() });
      }

      case "get_tree": {
        const sessionManager = session.sessionManager;
        return success(id, "get_tree", {
          tree: sessionManager.getTree(),
          leafId: sessionManager.getLeafId(),
        });
      }

      case "get_last_assistant_text": {
        const text = session.getLastAssistantText();
        return success(id, "get_last_assistant_text", { text });
      }

      case "set_session_name": {
        const name = command.name.trim();
        if (!name) {
          return error(id, "set_session_name", "Session name cannot be empty");
        }
        session.setSessionName(name);
        return success(id, "set_session_name");
      }

      // =================================================================
      // Messages
      // =================================================================

      case "get_messages": {
        return success(id, "get_messages", { messages: session.messages });
      }

      // =================================================================
      // Commands (available for invocation via prompt)
      // =================================================================

      case "get_commands": {
        const commands: RpcSlashCommand[] = [];

        for (const registered of session.extensionRunner.getRegisteredCommands()) {
          commands.push({
            name: registered.invocationName,
            description: registered.description,
            source: "extension",
            sourceInfo: registered.sourceInfo,
          });
        }

        for (const template of session.promptTemplates) {
          commands.push({
            name: template.name,
            description: template.description,
            source: "prompt",
            sourceInfo: template.sourceInfo,
          });
        }

        for (const skill of session.resourceLoader.getSkills().skills) {
          commands.push({
            name: `skill:${skill.name}`,
            description: skill.description,
            source: "skill",
            sourceInfo: skill.sourceInfo,
          });
        }

        return success(id, "get_commands", { commands });
      }

      default: {
        const unknownCommand = command as { type: string };
        return error(id, unknownCommand.type, `Unknown command: ${unknownCommand.type}`);
      }
    }
  };

  /**
   * Check if shutdown was requested and perform shutdown if so.
   * Called after handling each command when waiting for the next command.
   */
  let detachInput = () => {
    /* assigned once stdin listeners are attached */
  };

  /** Dispose the runtime and exit. Runs once; later calls (stdin EOF after a signal) do nothing. */
  async function shutdown(exitCode = 0, signal?: NodeJS.Signals): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    unsubscribe?.();
    unsubscribeBackpressure?.();
    try {
      await runtimeHost.dispose();
      detachInput();
      process.stdin.pause();
      if (signal !== "SIGTERM") {
        await flushRawStdout();
      }
      exitRpcMode(exitCode);
    } catch (cause: unknown) {
      detachInput();
      process.stdin.pause();
      for (const cleanup of signalCleanupHandlers) {
        cleanup();
      }
      signalCleanupHandlers.length = 0;
      rejectKeepAlive?.(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }

  /**
   * Shut down if an extension requested it and nothing still needs the process: input is attached,
   * no command (including a prompt that has not settled) is being handled, and the session is idle.
   * Each of those ending calls this again.
   */
  function checkShutdownRequested(): void {
    if (
      !shutdownRequested ||
      shuttingDown ||
      !inputReady ||
      activeCommands > 0 ||
      !session.isIdle
    ) {
      return;
    }
    void shutdown();
  }

  const handleInputLine = async (line: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (parseError: unknown) {
      output(
        error(
          undefined,
          "parse",
          `Failed to parse command: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        ),
      );
      await waitForRawStdoutBackpressure();
      return;
    }

    // Handle extension UI responses
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      parsed.type === "extension_ui_response"
    ) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- type already === "extension_ui_response"
      const response = parsed as RpcExtensionUIResponse;
      const pending = pendingExtensionRequests.get(response.id);
      if (pending) {
        pendingExtensionRequests.delete(response.id);
        pending.resolve(response);
      }
      return;
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSONL command; handleCommand switches on type
    const command = parsed as RpcCommand;
    activeCommands++;
    try {
      let response: RpcResponse | undefined;
      try {
        response = await handleCommand(command);
      } finally {
        activeCommands--;
      }
      if (response) {
        output(response);
        await waitForRawStdoutBackpressure();
      }
      checkShutdownRequested();
    } catch (commandError: unknown) {
      output(
        error(
          command.id,
          command.type,
          commandError instanceof Error ? commandError.message : String(commandError),
        ),
      );
      await waitForRawStdoutBackpressure();
    }
  };

  const onInputEnd = () => {
    void shutdown();
  };
  process.stdin.on("end", onInputEnd);

  detachInput = (() => {
    const detachJsonl = attachJsonlLineReader(process.stdin, (line) => {
      void handleInputLine(line);
    });
    acceptingUiResponses = true;
    return () => {
      detachJsonl();
      process.stdin.off("end", onInputEnd);
    };
  })();
  inputReady = true;
  // Handle a shutdown requested during startup (e.g. from session_start).
  checkShutdownRequested();

  // Keep process alive until shutdown() rejects keepAlive
  return keepAlive;
}
