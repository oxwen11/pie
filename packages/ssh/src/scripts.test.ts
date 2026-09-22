import childProcess from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
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
command -v pie
command -v node
command -v bun || true
node -v
`;
  return new Promise((resolve) => {
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
    expect(script).toContain("unset NODE_ENV PIE_DAEMON_DIR PIE_AUTH_TOKEN");
    expect(script).not.toContain("unset NODE_ENV PIE_HOME");
    expect(script.indexOf("emit_daemon_record attach")).toBeLessThan(
      script.indexOf('"$RUNNER_FILE" daemon start'),
    );
    expect(script).toContain("daemon start");
    expect(script).toContain("/api/health");
    expect(script).toContain("PIE_RUNTIME_HOME=");
    expect(script).toContain("PIE_HOME:-$HOME/.pie");
    expect(script).toContain('DAEMON_RECORD="$PIE_RUNTIME_HOME/daemon/daemon.pid"');
    expect(script).toContain("/ssh-launch/");
    expect(script).toContain("remotePort: port");
    expect(script).toContain("token: token");
    expect(script).toContain("os.hostname()");
    expect(script).not.toContain("serverKind");
    expect(script).not.toContain("@@PIE_");
  });

  it("prefers a PATH pie, then npx @getpie/cli@latest", () => {
    const runner = buildRemotePieRunnerScript({ packageSpec: DEFAULT_PIE_PACKAGE_SPEC });
    expect(runner).toContain("command -v pie");
    expect(runner).toContain("@getpie/cli@latest");
    expect(runner).toContain("npx --yes --package");
    expect(runner).toContain("-- pie");
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
    const script = buildRemoteLaunchScript();
    expect(script).toContain("v24.*");
    expect(script).toContain("VOLTA_HOME");
    expect(script).not.toContain("nvm.sh");
    expect(script).not.toContain("NVM_NO_USE");
    expect(script).not.toContain("fnm env");
    expect(script).not.toContain("mise activate");
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
  it("adds the standard Bun install to the daemon PATH", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "pie-ssh-bun-"));
    try {
      await writeExecutable(path.join(home, ".local", "bin", "pie"), "#!/bin/sh\necho pie-ok\n");
      const bun = path.join(home, ".bun", "bin", "bun");
      await writeExecutable(bun, "#!/bin/sh\necho bun-ok\n");
      const nodeBin = path.join(home, "node", "bin");
      await writeExecutable(path.join(nodeBin, "node"), nodeShim("v24.0.0"));

      const result = await runEnsure(home, `${nodeBin}:/usr/bin:/bin`);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(bun);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });

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

  it("keeps the first Node 24 match from a version-manager glob", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "pie-ssh-node-first-"));
    try {
      const first = path.join(
        home,
        ".local",
        "share",
        "fnm",
        "node-versions",
        "v24.0.0",
        "installation",
        "bin",
        "node",
      );
      const last = path.join(
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
      await writeExecutable(first, nodeShim("v24.0.0"));
      await writeExecutable(last, nodeShim("v24.18.0"));
      await writeExecutable(path.join(home, ".local", "bin", "pie"), "#!/bin/sh\necho pie-ok\n");
      // PATH must not already contain Node 24, or ensure_remote_node_path
      // returns before the fnm glob (CI images ship /usr/bin/node v24.x).
      const other = path.join(home, "opt", "other", "bin");
      await writeExecutable(path.join(other, "node"), nodeShim("v25.2.1"));

      const result = await runEnsure(home, `${other}:/bin`);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("v24.0.0");
      expect(result.stdout).not.toContain("v24.18.0");
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it("attaches to a healthy ~/.pie/daemon without starting pie", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "pie-ssh-attach-"));
    const server = http.createServer((request, response) => {
      response.end(request.url === "/api/health" ? "ok" : "");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const listened = server.address();
    if (listened === null || typeof listened === "string") {
      server.close();
      throw new Error("health server did not listen");
    }
    try {
      const bin = path.join(home, "bin");
      await installNodeShim(bin);
      await writeExecutable(
        path.join(bin, "pie"),
        '#!/bin/sh\necho called > "$HOME/pie-called"\nexit 99\n',
      );
      await fs.mkdir(path.join(home, ".pie", "daemon"), { recursive: true });
      await fs.writeFile(
        path.join(home, ".pie", "daemon", "daemon.pid"),
        JSON.stringify({
          pid: process.pid,
          address: `http://127.0.0.1:${String(listened.port)}`,
          token: "secret-token",
          startedAt: 1,
        }),
      );

      const result = await runLaunch(home, `${bin}:/usr/bin:/bin`);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`"remotePort":${String(listened.port)}`);
      expect(result.stdout).toContain('"token":"secret-token"');
      await expect(fs.stat(path.join(home, "pie-called"))).rejects.toThrow(/ENOENT/);
    } finally {
      server.close();
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it("attaches to the daemon under PIE_HOME", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "pie-ssh-home-"));
    const pieHome = path.join(home, "pie-test");
    const server = http.createServer((request, response) => {
      response.end(request.url === "/api/health" ? "ok" : "");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const listened = server.address();
    if (listened === null || typeof listened === "string") {
      server.close();
      throw new Error("health server did not listen");
    }
    try {
      const bin = path.join(home, "bin");
      await installNodeShim(bin);
      await writeExecutable(
        path.join(bin, "pie"),
        '#!/bin/sh\necho called > "$HOME/pie-called"\nexit 99\n',
      );
      await fs.mkdir(path.join(pieHome, "daemon"), { recursive: true });
      await fs.writeFile(
        path.join(pieHome, "daemon", "daemon.pid"),
        JSON.stringify({
          pid: process.pid,
          address: `http://127.0.0.1:${String(listened.port)}`,
          token: "secret-token",
          startedAt: 1,
        }),
      );

      const result = await runLaunch(home, `${bin}:/usr/bin:/bin`, { PIE_HOME: pieHome });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`"remotePort":${String(listened.port)}`);
      await expect(fs.stat(path.join(home, "pie-called"))).rejects.toThrow(/ENOENT/);
      await expect(fs.stat(path.join(home, ".pie"))).rejects.toThrow(/ENOENT/);
    } finally {
      server.close();
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it("starts pie when the recorded daemon is not alive", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "pie-ssh-start-"));
    try {
      const bin = path.join(home, "bin");
      await installNodeShim(bin);
      await writeExecutable(
        path.join(bin, "pie"),
        `#!/bin/sh
mkdir -p "$HOME/.pie/daemon"
printf '%s\n' '{"pid":1,"address":"http://127.0.0.1:9","token":"started-token","startedAt":1}' > "$HOME/.pie/daemon/daemon.pid"
echo called > "$HOME/pie-called"
exit 0
`,
      );
      await fs.mkdir(path.join(home, ".pie", "daemon"), { recursive: true });
      await fs.writeFile(
        path.join(home, ".pie", "daemon", "daemon.pid"),
        JSON.stringify({
          pid: 2_147_483_646,
          address: "http://127.0.0.1:9",
          token: "stale",
          startedAt: 1,
        }),
      );

      const result = await runLaunch(home, `${bin}:/usr/bin:/bin`);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('"remotePort":9');
      expect(result.stdout).toContain('"token":"started-token"');
      await expect(fs.readFile(path.join(home, "pie-called"), "utf8")).resolves.toContain("called");
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });
});

async function installNodeShim(bin: string): Promise<void> {
  const node = process.execPath.replaceAll("'", String.raw`'\''`);
  await writeExecutable(
    path.join(bin, "node"),
    `#!/bin/sh
if [ "$1" = "-v" ]; then
  echo v24.18.0
  exit 0
fi
exec '${node}' "$@"
`,
  );
}

function runLaunch(
  home: string,
  pathEnv: string,
  extra: NodeJS.ProcessEnv = {},
): Promise<{ stdout: string; stderr: string; status: number }> {
  const script = buildRemoteLaunchScript();
  return new Promise((resolve) => {
    const child = childProcess.spawn("/bin/sh", ["-s", "state"], {
      env: { HOME: home, PATH: pathEnv, TMPDIR: os.tmpdir(), ...extra },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 10_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, status: code ?? 1 });
    });
    child.stdin.end(script);
  });
}
