import childProcess from "node:child_process";

const extra = process.argv.slice(2);
if (extra[0] === "--") extra.shift();

const run = (command, args) => {
  const result = childProcess.spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  return result.status === 0;
};

if (
  run("pnpm", ["exec", "turbo", "run", "build", "--filter=@getpie/core", "--filter=@getpie/cli"])
) {
  run("pnpm", ["exec", "vitest", "run", ...extra]);
}
