import childProcess from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildRemoteLaunchScript,
  buildRemoteNodeEnvScript,
  buildRemotePieRunnerScript,
  DEFAULT_NODE_ENGINE_RANGE,
  DEFAULT_PIE_PACKAGE_SPEC,
  resolveRemotePiePackageSpec,
} from "./scripts";

const posix = process.platform !== "win32";

async function writeExecutable(file: string, body: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
  await fs.chmod(file, 0o755);
}

function nodeShim(version: string): string {
  return `#!/bin/sh\necho ${version}\n`;
}

async function runEnsure(
  home: string,
  pathEnv: string,
): Promise<{
  stdout: string;
  stderr: string;
  status: number;
}> {
  const script = `set -eu
${buildRemoteNodeEnvScript()}
if ! ensure_remote_node_path; then
  exit 1
fi
command -v node
node -v
`;
  return await new Promise((resolve) => {
    childProcess.execFile(
      "/bin/sh",
      ["-c", script],
      { env: { HOME: home, PATH: pathEnv }, timeout: 10_000 },
      (error, stdout, stderr) => {
        const status = error && typeof error.code === "number" ? error.code : error ? 1 : 0;
        resolve({ stdout, stderr, status });
      },
    );
  });
}

describe("remote launch scripts", () => {
  it("starts or attaches the remote pie daemon and prints launch JSON", () => {
    const script = buildRemoteLaunchScript();
    expect(script).toContain("unset NODE_ENV PIE_HOME PIE_DAEMON_DIR PIE_AUTH_TOKEN");
    expect(script).toContain("daemon start");
    expect(script).toContain("$HOME/.pie/daemon/daemon.pid");
    expect(script).toContain("$HOME/.pie/ssh-launch/");
    expect(script).toContain('serverKind: "daemon"');
    expect(script).not.toContain("@@PIE_");
  });

  it("prefers a PATH pie, then npx @getpie/cli@latest", () => {
    const runner = buildRemotePieRunnerScript({ packageSpec: DEFAULT_PIE_PACKAGE_SPEC });
    expect(runner).toContain("command -v pie");
    expect(runner).toContain("@getpie/cli@latest");
    expect(runner).toContain("ensure_remote_node_path");
    expect(runner).toContain(DEFAULT_NODE_ENGINE_RANGE);
  });

  it("embeds an explicit package spec for remote npx", () => {
    const runner = buildRemotePieRunnerScript({
      packageSpec: "https://pkg.pr.new/oxwen11/pie/@getpie/cli@deadbeef",
    });
    expect(runner).toContain("https://pkg.pr.new/oxwen11/pie/@getpie/cli@deadbeef");
  });

  it("embeds the Node 24 engine check", () => {
    const script = buildRemoteLaunchScript({ nodeEngineRange: DEFAULT_NODE_ENGINE_RANGE });
    expect(script).toContain("v24.*");
    expect(script).toContain("VOLTA_HOME");
    expect(script).toContain("nvm.sh");
    expect(script).toContain("NVM_NO_USE");
    expect(script).toContain("node-versions");
    expect(script).toContain("pie needs Node 24");
  });
});

describe("resolveRemotePiePackageSpec", () => {
  it("prefers an explicit spec, then PIE_SSH_CLI_PACKAGE, then latest", () => {
    expect(resolveRemotePiePackageSpec("@getpie/cli@0.0.0", { PIE_SSH_CLI_PACKAGE: "x" })).toBe(
      "@getpie/cli@0.0.0",
    );
    expect(resolveRemotePiePackageSpec("  ", { PIE_SSH_CLI_PACKAGE: " @getpie/cli@next " })).toBe(
      "@getpie/cli@next",
    );
    expect(resolveRemotePiePackageSpec(undefined, {})).toBe("@getpie/cli@latest");
  });
});

describe.skipIf(!posix)("ensure_remote_node_path", () => {
  it("picks fnm Node 24 over nvm 20 and a PATH Node 25", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "pie-ssh-node-"));
    try {
      const brewBin = path.join(home, "brew", "bin");
      await writeExecutable(path.join(brewBin, "node"), nodeShim("v25.2.1"));
      await writeExecutable(
        path.join(home, ".nvm", "versions", "node", "v20.9.0", "bin", "node"),
        nodeShim("v20.9.0"),
      );
      await writeExecutable(
        path.join(home, ".nvm", "nvm.sh"),
        `PATH="$HOME/.nvm/versions/node/v20.9.0/bin:$PATH"
export PATH
nvm() { :; }
`,
      );
      const fnmNode = path.join(
        home,
        ".local",
        "share",
        "fnm",
        "node-versions",
        "v24.18.0",
        "installation",
        "bin",
        "node",
      );
      await writeExecutable(fnmNode, nodeShim("v24.18.0"));

      const pieBin = path.join(home, ".local", "bin", "pie");
      await writeExecutable(pieBin, "#!/bin/sh\necho pie-ok\n");

      const result = await runEnsure(home, `${brewBin}:/usr/bin:/bin`);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("v24.18.0");
      expect(result.stdout).toContain(`${path.dirname(fnmNode)}/node`);
      expect(result.stdout.split("\n")[0]).toContain("/.local/bin");
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });
});
