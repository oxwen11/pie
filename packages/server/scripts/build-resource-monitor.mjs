import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const root = path.resolve(here, "../../..");
const executable = `pie-resource-monitor${process.platform === "win32" ? ".exe" : ""}`;
// pie-resource-monitor#build writes the release binary. Rebuild only when this
// script is invoked outside that task.
const source = path.resolve(root, "target", "release", executable);
if (!fs.existsSync(source)) {
  const result = childProcess.spawnSync(
    "cargo",
    ["build", "--release", "--locked", "--package", "pie-resource-monitor"],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  if (result.status !== 0) throw new Error("Failed to build resource monitor");
}
const destination = path.resolve(
  here,
  `../dist/resources/resource-monitor${process.platform === "win32" ? ".exe" : ""}`,
);
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.copyFileSync(source, destination);
if (process.platform !== "win32") fs.chmodSync(destination, 0o755);
