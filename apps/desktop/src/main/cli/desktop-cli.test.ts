import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, Result } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { makeDesktopCli } from "./desktop-cli";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

function setup(options: { shell?: string; path?: (home: string) => string[] } = {}) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pie-desktop-cli-")));
  homes.push(home);
  const script = path.join(home, "Pie.app/Contents/Resources/bin/pie");
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, "#!/bin/sh\n", { mode: 0o755 });
  const cli = Effect.runSync(
    makeDesktopCli({
      script,
      home,
      env: {
        SHELL: options.shell ?? "/bin/zsh",
        PATH: (options.path?.(home) ?? ["/usr/bin", "/bin"]).join(":"),
      },
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.result(effect));
  const link = path.join(home, ".local/bin/pie");
  return { home, script, cli, run, link };
}

describe("DesktopCli", () => {
  it("links ~/.local/bin/pie to the app and adds the directory to .zshrc once", async () => {
    const { home, script, cli, run, link } = setup();
    fs.writeFileSync(path.join(home, ".zshrc"), "alias ll='ls -l'");

    const installed = await run(cli.install);
    expect(Result.getOrThrow(installed)).toEqual({
      installed: true,
      path: "~/.local/bin/pie",
      conflict: null,
      onPath: true,
      shadowedBy: null,
    });
    expect(fs.readlinkSync(link)).toBe(script);

    await run(cli.install);
    expect(fs.readFileSync(path.join(home, ".zshrc"), "utf8")).toBe(
      "alias ll='ls -l'\n\n# Added by Pie Desktop for the pie command\nexport PATH=\"$HOME/.local/bin:$PATH\"\n",
    );
  });

  it("leaves the shell startup file alone when ~/.local/bin is already on PATH", async () => {
    const { home, cli, run } = setup({ path: (dir) => [path.join(dir, ".local/bin"), "/bin"] });

    expect(Result.getOrThrow(await run(cli.install)).onPath).toBe(true);
    expect(fs.existsSync(path.join(home, ".zshrc"))).toBe(false);
  });

  it("writes fish's config and reports an unknown shell as not on PATH", async () => {
    const fish = setup({ shell: "/opt/homebrew/bin/fish" });
    await fish.run(fish.cli.install);
    expect(fs.readFileSync(path.join(fish.home, ".config/fish/config.fish"), "utf8")).toContain(
      "fish_add_path $HOME/.local/bin",
    );

    const other = setup({ shell: "/bin/tcsh" });
    const status = Result.getOrThrow(await other.run(other.cli.install));
    expect(status).toMatchObject({ installed: true, onPath: false });
    expect(fs.readdirSync(other.home).filter((name) => name.startsWith("."))).toEqual([".local"]);
  });

  it("refuses to replace a file that is not a symlink", async () => {
    const { cli, run, link } = setup();
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.writeFileSync(link, "#!/bin/sh\necho mine\n");

    const status = Result.getOrThrow(await run(cli.status));
    expect(status.conflict).toContain("~/.local/bin/pie already exists and is not a symlink");
    const installed = await run(cli.install);
    expect(Result.isFailure(installed)).toBe(true);
    expect(fs.readFileSync(link, "utf8")).toBe("#!/bin/sh\necho mine\n");
  });

  it("replaces another symlink but uninstalls only its own", async () => {
    const { script, cli, run, link } = setup();
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync("/old/Pie.app/Contents/Resources/bin/pie", link);

    expect(Result.getOrThrow(await run(cli.status)).installed).toBe(false);
    await run(cli.uninstall);
    expect(fs.readlinkSync(link)).toBe("/old/Pie.app/Contents/Resources/bin/pie");

    await run(cli.install);
    expect(fs.readlinkSync(link)).toBe(script);
    expect(Result.getOrThrow(await run(cli.uninstall)).installed).toBe(false);
    expect(fs.existsSync(link)).toBe(false);
    expect(fs.readdirSync(path.dirname(link))).toEqual([]);
  });

  it("reports a pie that the login PATH reaches first", async () => {
    const { home, cli, run } = setup({
      path: (dir) => [path.join(dir, "npm/bin"), path.join(dir, ".local/bin")],
    });
    fs.mkdirSync(path.join(home, "npm/bin"), { recursive: true });
    fs.writeFileSync(path.join(home, "npm/bin/pie"), "");

    expect(Result.getOrThrow(await run(cli.install)).shadowedBy).toBe("~/npm/bin/pie");
  });

  it("refuses to link an app that runs from a disk image", async () => {
    const cli = Effect.runSync(
      makeDesktopCli({
        script: "/Volumes/Pie/Pie.app/Contents/Resources/bin/pie",
        home: os.tmpdir(),
        env: { PATH: "/bin" },
      }).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    const result = await Effect.runPromise(Effect.result(cli.install));
    expect(Result.isFailure(result) && result.failure.message).toContain("Applications folder");
  });
});
