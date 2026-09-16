import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const fromHere = (relative: string) => url.fileURLToPath(new URL(relative, import.meta.url));

const repoRoot = fromHere("../../..");
const cliEntry = fromHere("../../../packages/pie/src/node/cli.ts");
const tsx = path.join(repoRoot, "node_modules/.bin/tsx");
const fakePi = path.join(repoRoot, "tools/testing/fake-pi.mjs");
const fakeGh = path.join(repoRoot, "tools/testing/fake-gh.mjs");

const SAMPLE = "sample";
const SAMPLE_GIT = "sample-git";
const FAKE_REPLY = "E2E fake Pi reply";

function writeSample(workspace: string): void {
  const sample = path.join(workspace, SAMPLE);
  fs.mkdirSync(sample, { recursive: true });
  fs.writeFileSync(path.join(sample, "README.md"), "# sample\n\nPie e2e workspace.\n");
}

function writeGitSample(workspace: string): void {
  const dir = path.join(workspace, SAMPLE_GIT);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), "# sample-git\n");
  const git = (args: string[]) => childProcess.execFileSync("git", args, { cwd: dir });
  git(["init", "-b", "main"]);
  git(["config", "user.email", "e2e@example.com"]);
  git(["config", "user.name", "Pie E2E"]);
  git(["add", "."]);
  git(["commit", "-m", "init"]);
}

function waitReady(child: childProcess.ChildProcess, timeoutMs = 45_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      reject(new Error(`pie serve never became ready:\n${output}`));
    }, timeoutMs);
    const onExit = (code: number | null) => {
      clearTimeout(timer);
      reject(new Error(`pie serve exited with ${code}:\n${output}`));
    };
    const scan = (chunk: Buffer) => {
      output += chunk.toString();
      const ready = output.match(/pie:ready\s*({.+})/);
      if (ready?.[1]) {
        clearTimeout(timer);
        child.off("exit", onExit);
        const { port } = JSON.parse(ready[1]) as { port: number };
        resolve(`http://127.0.0.1:${port}`);
      }
    };
    child.stdout?.on("data", scan);
    child.stderr?.on("data", scan);
    child.once("exit", onExit);
  });
}

async function assertUiBuilt(httpBaseUrl: string): Promise<void> {
  const response = await fetch(httpBaseUrl, { redirect: "manual" });
  if (response.status === 503) {
    throw new Error(
      "Web UI not built. Run `pnpm exec turbo run build --filter=@getpie/app` first.",
    );
  }
}

export default async function globalSetup(): Promise<() => void> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-app-e2e-"));
  const workspace = path.join(home, "workspace");
  const bin = path.join(home, "bin");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  writeSample(workspace);
  writeGitSample(workspace);
  const gh = path.join(bin, "gh");
  fs.copyFileSync(fakeGh, gh);
  fs.chmodSync(gh, 0o755);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    PIE_HOME: home,
    PIE_PORT: "0",
    PIE_E2E: "1",
    PIE_E2E_PI_EXECUTABLE: fakePi,
    PIE_E2E_PI_RESPONSE: FAKE_REPLY,
    PIE_PROJECT_BROWSE_ROOT: workspace,
    PIE_DAEMON_COMPATIBILITY_KEY: "githash:00000000",
  };

  const serve = childProcess.spawn(tsx, [cliEntry, "serve"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const httpBaseUrl = await waitReady(serve);
  await assertUiBuilt(httpBaseUrl);

  process.env.PIE_E2E_BASE_URL = httpBaseUrl;
  process.env.PIE_E2E_SAMPLE = SAMPLE;
  process.env.PIE_E2E_SAMPLE_GIT = SAMPLE_GIT;
  process.env.PIE_E2E_FAKE_REPLY = FAKE_REPLY;

  return () => {
    serve.kill("SIGTERM");
  };
}
