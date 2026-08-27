import childProcess from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(import.meta.filename), "../..");

const bundle = (entry, outfile) => {
  const result = childProcess.spawnSync(
    "pnpm",
    [
      "dlx",
      "esbuild",
      entry,
      "--bundle",
      "--packages=external",
      "--format=esm",
      "--platform=node",
      `--outfile=${outfile}`,
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

bundle("tools/oxlint/anti-slop/index.ts", "tools/oxlint/anti-slop.mjs");
bundle("tools/oxlint/anti-slop/effect/index.ts", "tools/oxlint/anti-slop-effect.mjs");
