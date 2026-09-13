import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const root = path.resolve(here, "../../..");
const manifest = path.resolve(root, "native/resource-monitor/Cargo.toml");
const result = childProcess.spawnSync(
  "cargo",
  ["build", "--release", "--locked", "--manifest-path", manifest],
  {
    cwd: root,
    stdio: "inherit",
  },
);
if (result.status !== 0) throw new Error("Failed to build resource monitor");

const source = path.resolve(
  root,
  `native/resource-monitor/target/release/pie-resource-monitor${process.platform === "win32" ? ".exe" : ""}`,
);
const destination = path.resolve(
  here,
  `../dist/resources/resource-monitor${process.platform === "win32" ? ".exe" : ""}`,
);
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.copyFileSync(source, destination);
if (process.platform !== "win32") fs.chmodSync(destination, 0o755);
