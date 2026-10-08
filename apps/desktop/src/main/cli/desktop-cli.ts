import os from "node:os";
import path from "node:path";

import { Context, Data, Effect, FileSystem, Layer } from "effect";

import type { CliCommandStatus } from "../../shared/desktop-rpc";
import { DesktopConfig } from "../desktop-config";
import { LoginShellEnvironment } from "../server/login-shell-environment";

export class CliInstallError extends Data.TaggedError("CliInstallError")<{
  readonly message: string;
}> {}

/**
 * Settings → Command line. Install symlinks `~/.local/bin/pie` to the `pie`
 * script inside this app and, when that directory is not on the login shell's
 * PATH, appends one marked line to the shell's startup file. Uninstall removes
 * only a link that points at this app.
 */
export class DesktopCli extends Context.Service<
  DesktopCli,
  {
    /** This build ships the command. */
    readonly available: boolean;
    readonly status: Effect.Effect<CliCommandStatus>;
    readonly install: Effect.Effect<CliCommandStatus, CliInstallError>;
    readonly uninstall: Effect.Effect<CliCommandStatus, CliInstallError>;
  }
>()("desktop/DesktopCli") {}

/** A build without the command, e.g. development. */
export function disabledDesktopCli(): DesktopCli["Service"] {
  const status = Effect.succeed({
    installed: false,
    path: "~/.local/bin/pie",
    conflict: null,
    onPath: false,
    shadowedBy: null,
  });
  const unavailable = Effect.fail(
    new CliInstallError({ message: "This build of Pie does not include the pie command." }),
  );
  return DesktopCli.of({ available: false, status, install: unavailable, uninstall: unavailable });
}

const PATH_LINE = 'export PATH="$HOME/.local/bin:$PATH"';
const LOCAL_BIN = ".local/bin";

/** The startup file Install edits for each supported login shell. */
export function shellProfile(
  shell: string | undefined,
  home: string,
): { readonly file: string; readonly line: string } | undefined {
  switch (path.basename(shell ?? "")) {
    case "zsh":
      return { file: path.join(home, ".zshrc"), line: PATH_LINE };
    case "bash":
      return { file: path.join(home, ".bash_profile"), line: PATH_LINE };
    case "fish":
      return {
        file: path.join(home, ".config", "fish", "config.fish"),
        line: "fish_add_path $HOME/.local/bin",
      };
    default:
      return undefined;
  }
}

export function makeDesktopCli(input: {
  /** The app's `Resources/bin/pie`; undefined when this build does not ship one. */
  readonly script: string | undefined;
  readonly home: string;
  /** Login shell environment: its PATH and SHELL decide what Install edits. */
  readonly env: NodeJS.ProcessEnv;
}): Effect.Effect<DesktopCli["Service"], never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { script, home } = input;
    const binDir = path.join(home, ".local", "bin");
    const link = path.join(binDir, "pie");
    const pathDirs = (input.env.PATH ?? "").split(path.delimiter).filter((dir) => dir !== "");
    const profile = shellProfile(input.env.SHELL, home);
    const tilde = (pathname: string) =>
      pathname.startsWith(`${home}/`) ? `~${pathname.slice(home.length)}` : pathname;
    const conflictMessage = `${tilde(link)} already exists and is not a symlink. Remove it, then install again.`;

    const existing = fs.readLink(link).pipe(
      Effect.map((target) => ({ kind: "link", target }) as const),
      Effect.catch((error) =>
        error.reason._tag === "NotFound"
          ? Effect.succeed({ kind: "missing" } as const)
          : fs.exists(link).pipe(
              // Unknown means "do not overwrite".
              Effect.orElseSucceed(() => true),
              Effect.map((exists) =>
                exists ? ({ kind: "file" } as const) : ({ kind: "missing" } as const),
              ),
            ),
      ),
    );

    const profileMentionsBin =
      profile === undefined
        ? Effect.succeed(false)
        : fs.readFileString(profile.file).pipe(
            Effect.map((content) => content.includes(LOCAL_BIN)),
            Effect.orElseSucceed(() => false),
          );

    /** Another `pie` that the login PATH reaches before `~/.local/bin`. */
    const shadowingPie = Effect.gen(function* () {
      for (const dir of pathDirs) {
        if (dir === binDir) return null;
        const candidate = path.join(dir, "pie");
        if (yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false))) {
          return tilde(candidate);
        }
      }
      return null;
    });

    const status = Effect.gen(function* () {
      const current = yield* existing;
      return {
        installed: current.kind === "link" && current.target === script,
        path: tilde(link),
        conflict: current.kind === "file" ? conflictMessage : null,
        onPath: pathDirs.includes(binDir) || (yield* profileMentionsBin),
        shadowedBy: yield* shadowingPie,
      } satisfies CliCommandStatus;
    });

    const install = Effect.gen(function* () {
      if (script === undefined) {
        return yield* new CliInstallError({
          message: "This build of Pie does not include the pie command.",
        });
      }
      // A link into a disk image or a translocated copy breaks once it goes away.
      if (script.startsWith("/Volumes/") || script.includes("/AppTranslocation/")) {
        return yield* new CliInstallError({
          message: "Move Pie to the Applications folder, open it from there, then install again.",
        });
      }
      if ((yield* existing).kind === "file") {
        return yield* new CliInstallError({ message: conflictMessage });
      }
      yield* fs.makeDirectory(binDir, { recursive: true });
      // Rename over the old link so `pie` never disappears mid-install.
      const temporary = `${link}.${process.pid}.tmp`;
      yield* fs.remove(temporary, { force: true });
      yield* fs.symlink(script, temporary);
      yield* fs.rename(temporary, link);

      if (profile !== undefined && !pathDirs.includes(binDir)) {
        const content = yield* fs.readFileString(profile.file).pipe(Effect.orElseSucceed(() => ""));
        if (!content.includes(LOCAL_BIN)) {
          yield* fs.makeDirectory(path.dirname(profile.file), { recursive: true });
          const separator = content === "" || content.endsWith("\n") ? "" : "\n";
          yield* fs.writeFileString(
            profile.file,
            `${separator}\n# Added by Pie Desktop for the pie command\n${profile.line}\n`,
            { flag: "a" },
          );
        }
      }
      return yield* status;
    }).pipe(
      Effect.catchTag("PlatformError", (error) =>
        Effect.fail(
          new CliInstallError({ message: `Could not install the pie command: ${error.message}` }),
        ),
      ),
    );

    const uninstall = Effect.gen(function* () {
      const current = yield* existing;
      if (current.kind === "link" && current.target === script) yield* fs.remove(link);
      return yield* status;
    }).pipe(
      Effect.catchTag("PlatformError", (error) =>
        Effect.fail(
          new CliInstallError({ message: `Could not uninstall the pie command: ${error.message}` }),
        ),
      ),
    );

    return DesktopCli.of({ available: script !== undefined, status, install, uninstall });
  });
}

export const DesktopCliLive = Layer.effect(
  DesktopCli,
  Effect.gen(function* () {
    const config = yield* DesktopConfig;
    const loginShell = yield* LoginShellEnvironment;
    const fs = yield* FileSystem.FileSystem;
    const script = path.join(config.resourcesPath, "bin", "pie");
    // Only the packaged macOS app ships the script.
    const shipped =
      config.isPackaged &&
      process.platform === "darwin" &&
      (yield* fs.exists(script).pipe(Effect.orElseSucceed(() => false)));
    return yield* makeDesktopCli({
      script: shipped ? script : undefined,
      home: os.homedir(),
      env: loginShell.env,
    });
  }),
);
