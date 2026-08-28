import path from "node:path";

import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { resolvePieHome } from "@getpie/server/daemon";
import * as ServerObservability from "@getpie/server/observability";
import { Effect, Layer, ManagedRuntime, Result } from "effect";
import { app, dialog } from "electron";

import icon from "../../resources/icon.png?asset";
import { makeDesktopConfigLive } from "./desktop-config";
import { DesktopApplicationLive, RendererChannelLive } from "./desktop-runtime-glue";
import { registerAppScheme } from "./electron/app-protocol";
import { MainWindow, MainWindowLive } from "./electron/main-window";
import { devUserDataPath, devWorktreeSlug, pieTempPath } from "./lib/utils";
import { LocalServerLive } from "./server/local-server-live";
import { formatStartupFailure } from "./startup-failure";

function isolateDesktopDevRuntime(): void {
  if (!process.env["PIE_DEV_SCOPE"]) return;

  const home = process.env["PIE_HOME"];
  if (home) process.env["PIE_HOME"] = path.join(home, "desktop");

  const daemonDir = process.env["PIE_DAEMON_DIR"];
  if (daemonDir) process.env["PIE_DAEMON_DIR"] = path.join(daemonDir, "desktop");

  const serverPort = process.env["PIE_DESKTOP_SERVER_PORT"];
  if (serverPort) process.env["PIE_PORT"] = serverPort;
}

function makeRuntime(devUrl: string | undefined) {
  // The Node platform services: the daemon launcher's file state and token
  // minting bubble these up their R channel, and this is where they land.
  const nodeBase = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeCrypto.layer);
  const ChildProcessSpawnerLive = NodeChildProcessSpawner.layer.pipe(Layer.provide(nodeBase));
  // provideMerge: nothing in this graph requires the logger, and Layer.provide
  // of an unused layer is dropped. Merge puts it in the runtime context so
  // supervisor Effect.log* reaches `$PIE_HOME/logs/pie.log`.
  const DesktopObservabilityLive = ServerObservability.layerForHome(resolvePieHome()).pipe(
    Layer.provide(nodeBase),
  );
  const DesktopConfigLive = makeDesktopConfigLive({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    devUrl,
  });

  return ManagedRuntime.make(
    MainWindowLive.pipe(
      Layer.provide(RendererChannelLive),
      Layer.provide(DesktopApplicationLive),
      Layer.provide(LocalServerLive),
      Layer.provide(DesktopConfigLive),
      Layer.provide(ChildProcessSpawnerLive),
      Layer.provideMerge(DesktopObservabilityLive),
      Layer.provide(nodeBase),
    ),
  );
}

export function startDesktopRuntime(): void {
  const isE2E = process.env["PIE_E2E"] === "1";
  if (isE2E && process.platform === "darwin") app.setActivationPolicy("accessory");
  if (is.dev && !isE2E) isolateDesktopDevRuntime();

  // Opt-in CDP remote debugging (agent-browser); isolated userData avoids the
  // single-instance lock.
  const remoteDebugPort = process.env["PIE_REMOTE_DEBUG_PORT"];
  if (remoteDebugPort) {
    app.commandLine.appendSwitch("remote-debugging-port", remoteDebugPort);
    app.setPath("userData", pieTempPath(`remote-debugging-${remoteDebugPort}`));
  } else if (is.dev && !isE2E) {
    // Give dev its own userData so its single-instance lock is independent of an
    // installed build (which on macOS keeps holding the lock after its window
    // closes). The mise dev environment supplies the same hashed worktree scope used for
    // data and ports; derive the same identity for direct Electron invocations
    // outside the package script. E2E supplies its own --user-data-dir.
    const worktreeScope = process.env["PIE_DEV_SCOPE"] ?? Effect.runSync(devWorktreeSlug);
    app.setPath("userData", devUserDataPath(worktreeScope));
  }

  let runtime: ReturnType<typeof makeRuntime> | undefined;
  let disposing = false;
  let allowQuit = false;

  const runWindowAction = (
    action: (window: MainWindow["Service"]) => Effect.Effect<void>,
  ): void => {
    runtime?.runFork(
      Effect.gen(function* () {
        const window = yield* MainWindow;
        yield* action(window);
      }),
    );
  };

  const disposeAndQuit = async (): Promise<void> => {
    if (disposing) return;
    disposing = true;
    try {
      await runtime?.dispose();
    } finally {
      runtime = undefined;
      allowQuit = true;
      app.quit();
    }
  };

  const startPrimaryInstance = async (): Promise<void> => {
    await app.whenReady();

    if (is.dev && process.platform === "darwin") app.dock?.setIcon(icon);

    electronApp.setAppUserModelId("com.pie.desktop");
    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    const devUrl = is.dev ? process.env["ELECTRON_RENDERER_URL"] : undefined;
    runtime = makeRuntime(devUrl);

    try {
      const startup = await runtime.runPromise(Effect.result(runtime.contextEffect));
      if (Result.isFailure(startup)) {
        dialog.showErrorBox("Pie could not start", formatStartupFailure(startup.failure));
        await disposeAndQuit();
        return;
      }
      await runtime.runPromise(
        Effect.gen(function* () {
          const window = yield* MainWindow;
          yield* window.ensureOpen;
        }),
      );
    } catch (error) {
      // Typed startup failures are handled above; this only catches defects.
      dialog.showErrorBox(
        "Pie could not start",
        error instanceof Error ? error.message : String(error),
      );
      await disposeAndQuit();
    }
  };

  if (!app.requestSingleInstanceLock()) {
    allowQuit = true;
    app.quit();
    return;
  }

  // Electron only accepts privileged scheme registration before ready.
  registerAppScheme();

  app.on("second-instance", () => runWindowAction((window) => window.focus));
  app.on("activate", () => runWindowAction((window) => window.ensureOpen));

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    if (allowQuit || !runtime) return;
    event.preventDefault();
    void disposeAndQuit();
  });

  void startPrimaryInstance();
}
