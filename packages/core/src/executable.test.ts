import { Effect, FileSystem, Layer, Option, PlatformError } from "effect";
import { expect, it } from "vitest";

import { findExecutable, type FindExecutableDeps } from "./executable";

const fileInfo = (type: FileSystem.File.Info["type"], mode: number): FileSystem.File.Info => ({
  type,
  mode,
  mtime: Option.none(),
  atime: Option.none(),
  birthtime: Option.none(),
  dev: 0,
  ino: Option.none(),
  nlink: Option.none(),
  uid: Option.none(),
  gid: Option.none(),
  rdev: Option.none(),
  size: FileSystem.Size(0),
  blksize: Option.none(),
  blocks: Option.none(),
});

const notFound = (path: string): PlatformError.PlatformError =>
  PlatformError.systemError({
    _tag: "NotFound",
    module: "FileSystem",
    method: "stat",
    pathOrDescriptor: path,
  });

const fakeStats = (
  entries: Readonly<Record<string, FileSystem.File.Info>>,
): Layer.Layer<FileSystem.FileSystem> =>
  Layer.succeed(
    FileSystem.FileSystem,
    FileSystem.makeNoop({
      stat: (path) => {
        const info = entries[path];
        return info ? Effect.succeed(info) : Effect.fail(notFound(path));
      },
    }),
  );

const fakeExecutables = (...paths: ReadonlyArray<string>): Layer.Layer<FileSystem.FileSystem> =>
  fakeStats(Object.fromEntries(paths.map((path) => [path, fileInfo("File", 0o755)])));

// The whole point of this resolver is to answer the same question the OS will
// answer when a transport calls `spawn("pi")`. Every test here is about that
// agreement: anything it finds that spawn wouldn't turns a clear "not found on
// PATH" into an opaque ENOENT once the user picks the harness.
const resolve = (
  command: string,
  deps: FindExecutableDeps,
  ...installed: ReadonlyArray<string>
): string | undefined =>
  Effect.runSync(findExecutable(command, deps).pipe(Effect.provide(fakeExecutables(...installed))));

it("resolves a bare command against PATH, in PATH order", () => {
  const resolved = resolve(
    "pi",
    { env: { PATH: "/first:/second" }, platform: "darwin" },
    "/first/pi",
    "/second/pi",
  );

  expect(resolved).toBe("/first/pi");
});

it("does not look outside PATH, because spawn will not either", () => {
  const resolved = resolve(
    "pi",
    { env: { PATH: "/usr/bin" }, platform: "darwin" },
    // Installed, but somewhere this process's PATH does not mention.
    "/Users/someone/.local/bin/pi",
  );

  expect(resolved).toBeUndefined();
});

it("takes an absolute command as an override and only checks it is runnable", () => {
  const deps = { env: { PATH: "" }, platform: "darwin" as const };

  expect(resolve("/opt/pi", deps, "/opt/pi")).toBe("/opt/pi");
  expect(resolve("/opt/missing", deps, "/opt/pi")).toBeUndefined();
});

// Paths stay posix-shaped because `node:path` follows the host running the
// test, not the `platform` we pass in; only the extension probing is under
// test here, and that is the part `platform` actually drives.
it("finds the .cmd shim npm installs on Windows, not just .exe", () => {
  const resolved = resolve("pi", { env: { PATH: "/bin" }, platform: "win32" }, "/bin/pi.cmd");

  expect(resolved).toBe("/bin/pi.cmd");
});

it("reports a missing command as undefined rather than guessing a path", () => {
  expect(resolve("pi", { env: { PATH: "/usr/bin:/bin" }, platform: "darwin" })).toBeUndefined();
});

// A directory carries the same execute bits a binary does, and `spawn` cannot
// run one — so the mode check alone would report a false hit.
it("ignores a directory that shares the command's name", () => {
  const resolved = Effect.runSync(
    findExecutable("pi", { env: { PATH: "/bin" }, platform: "darwin" }).pipe(
      Effect.provide(fakeStats({ "/bin/pi": fileInfo("Directory", 0o755) })),
    ),
  );

  expect(resolved).toBeUndefined();
});
