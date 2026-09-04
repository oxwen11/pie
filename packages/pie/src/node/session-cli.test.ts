import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

import type { SessionRef, SubscribeStreamEvent } from "@getpie/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CONNECT_HINT, createPieClientFromEndpoint } from "./connect";
import { printTurn } from "./session-cli";

const fromModuleUrl = (relative: string) => url.fileURLToPath(new URL(relative, import.meta.url));

const repoRoot = fromModuleUrl("../../../..");
const cliEntry = fromModuleUrl("./cli.ts");
const tsx = path.join(repoRoot, "node_modules/.bin/tsx");
const fakePi = path.join(repoRoot, "tools/testing/fake-pi.mjs");
const FAKE_REPLY = "CLI_FAKE_PI_REPLY";
const TEST_KEY = "githash:00000000";

const ref: SessionRef = {
  projectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  sessionId: "11111111-2222-3333-4444-555555555555",
};

describe("printTurn", () => {
  it("prints user text and assistant deltas until the turn ends", async () => {
    async function* stream(): AsyncIterable<SubscribeStreamEvent> {
      yield {
        type: "event",
        event: {
          ref,
          seq: 1,
          type: "session.prompt.submitted",
          messageId: "m1",
          parts: [{ type: "text", text: "hello" }],
        },
      };
      yield {
        type: "event",
        event: {
          ref,
          seq: 2,
          type: "session.message.chunk",
          turnId: "t1",
          chunk: { type: "text-delta", id: "x", delta: "pong" },
          phase: "running",
        },
      };
      yield {
        type: "event",
        event: {
          ref,
          seq: 3,
          type: "session.turn.ended",
          turnId: "t1",
          outcome: "completed",
        },
      };
    }
    let output = "";
    await printTurn(stream(), (text) => {
      output += text;
    });
    expect(output).toBe("user: hello\nassistant: pong\n");
  });
});

function pieEnv(home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PIE_HOME: home,
    PIE_DAEMON_DIR: path.join(home, "daemon"),
    PIE_PORT: "0",
    PIE_E2E: "1",
    PIE_E2E_PI_EXECUTABLE: fakePi,
    PIE_E2E_PI_RESPONSE: FAKE_REPLY,
    PIE_DAEMON_COMPATIBILITY_KEY: TEST_KEY,
    ...extra,
  };
}

function runCliResult(args: string[], env: NodeJS.ProcessEnv) {
  return childProcess.spawnSync(tsx, [cliEntry, ...args], {
    env,
    encoding: "utf8",
    timeout: 40_000,
  });
}

function runCli(args: string[], env: NodeJS.ProcessEnv): string {
  const result = runCliResult(args, env);
  const combined = `status ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\n${result.error?.message ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`pie ${args.join(" ")} failed\n${combined}`);
  }
  return result.stdout;
}

function parseCreated(stdout: string) {
  const match = stdout.match(/created session ([0-9a-f-]{36}) project ([0-9a-f-]{36})/i);
  const sessionId = match?.[1];
  const projectId = match?.[2];
  if (sessionId === undefined || projectId === undefined) {
    throw new Error(`no session identity in stdout:\n${stdout}`);
  }
  return { sessionId, projectId };
}

function parseDaemonAddress(status: string): string {
  const address = status.match(/at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
  if (address === undefined) {
    throw new Error(`no daemon address in status:\n${status}`);
  }
  return address;
}

function readDaemonRecord(home: string): {
  readonly pid: number;
  readonly address: string;
  readonly token: string;
} {
  const raw = fs.readFileSync(path.join(home, "daemon", "daemon.pid"), "utf8");
  return JSON.parse(raw) as { pid: number; address: string; token: string };
}

function initGitRepo(dir: string): void {
  const git = (args: string[]) =>
    childProcess.execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git(["init", "-b", "main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "hello\n");
  git(["add", "."]);
  git(["commit", "-m", "init"]);
}

async function waitReady(child: childProcess.ChildProcess, timeoutMs = 30_000): Promise<string> {
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

const swallowAbort = (run: () => Promise<void>) => {
  void run().catch(() => {
    // Server teardown closes the observer socket.
  });
};

async function waitFor(label: string, check: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 40);
    });
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("pie run against live serve", () => {
  let home: string;
  let workspace: string;
  let env: NodeJS.ProcessEnv;
  let address: string;
  let serve: childProcess.ChildProcess | undefined;
  let projectId: string;
  let closeObserver: (() => void) | undefined;
  const createdIds: string[] = [];

  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-cli-home-"));
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pie-cli-ws-"));
    env = pieEnv(home);
    serve = childProcess.spawn(tsx, [cliEntry, "serve"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    address = await waitReady(serve);
    env = { ...env, PIE_URL: address };

    const observer = createPieClientFromEndpoint({ address, token: undefined });
    closeObserver = observer.close;
    const firehose = await observer.client.agent.session.subscribe({
      scope: { kind: "global" },
    });
    swallowAbort(async () => {
      for await (const item of firehose) {
        if (item.type === "event" && item.event.type === "session.created") {
          createdIds.push(item.event.ref.sessionId);
        }
      }
    });

    const project = await observer.client.project.create({ path: workspace });
    projectId = project.id;
  }, 60_000);

  afterAll(() => {
    closeObserver?.();
    serve?.kill("SIGTERM");
    serve = undefined;
  });

  it("reuses the project registered at --cwd", () => {
    const first = parseCreated(runCli(["run", "--cwd", workspace, "CLI_CWD_A"], env));
    const second = parseCreated(runCli(["run", "--cwd", workspace, "CLI_CWD_B"], env));
    expect(first.projectId).toBe(projectId);
    expect(second.projectId).toBe(projectId);
    expect(first.sessionId).not.toBe(second.sessionId);
  }, 60_000);

  it("creates a project when --cwd is not yet registered", () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "pie-cli-new-proj-"));
    const created = parseCreated(runCli(["run", "--cwd", fresh, "CLI_NEW_CWD"], env));
    expect(created.projectId).not.toBe(projectId);
  }, 60_000);

  it("honors PIE_URL without passing --url", () => {
    const created = parseCreated(runCli(["run", "--project-id", projectId, "CLI_PIE_URL"], env));
    expect(created.projectId).toBe(projectId);
  }, 60_000);

  it("creates sessions via the real CLI and observers see them without refetching as creator", async () => {
    const first = runCli(["run", "--url", address, "--project-id", projectId, "CLI_CREATE_A"], env);
    const second = runCli(
      ["run", "--url", address, "--project-id", projectId, "CLI_CREATE_B"],
      env,
    );
    const a = parseCreated(first);
    const b = parseCreated(second);
    expect(a.projectId).toBe(projectId);
    expect(b.projectId).toBe(projectId);
    expect(a.sessionId).not.toBe(b.sessionId);

    await waitFor(
      "observer session.created for both CLI sessions",
      () => createdIds.includes(a.sessionId) && createdIds.includes(b.sessionId),
    );
  }, 60_000);

  it("pie run creates a session, prompts, and prints the turn", () => {
    const first = runCli(
      ["run", "--url", address, "--project-id", projectId, "CLI_RUN_ALPHA"],
      env,
    );
    const second = runCli(
      [
        "run",
        "--url",
        address,
        "--project-id",
        projectId,
        "--provider",
        "fake",
        "--model-id",
        "fake-pi",
        "CLI_RUN_BETA",
      ],
      env,
    );
    expect(first).toContain("user: CLI_RUN_ALPHA");
    expect(first).toContain(FAKE_REPLY);
    expect(second).toContain("user: CLI_RUN_BETA");
    expect(second).toContain(FAKE_REPLY);
    const a = parseCreated(first);
    const b = parseCreated(second);
    expect(a.projectId).toBe(projectId);
    expect(b.sessionId).not.toBe(a.sessionId);

    const followUp = runCli(
      [
        "run",
        "--url",
        address,
        "--project-id",
        projectId,
        "--session-id",
        a.sessionId,
        "CLI_RUN_GAMMA",
      ],
      env,
    );
    expect(followUp).toContain("user: CLI_RUN_GAMMA");
    expect(followUp).toContain(FAKE_REPLY);
    expect(followUp).not.toContain("created session");
  }, 60_000);

  it("syncs prompts both ways over the session subscribe stream", async () => {
    const observerHandle = createPieClientFromEndpoint({ address, token: undefined });
    try {
      const observer = observerHandle.client;
      const created = await observer.agent.session.create({ projectId });
      const observed: string[] = [];
      const stream = await observer.agent.session.subscribe({
        scope: { kind: "session", ref: created.ref },
      });
      swallowAbort(async () => {
        for await (const item of stream) {
          if (item.type !== "event") continue;
          const event = item.event;
          if (event.type === "session.prompt.submitted") {
            observed.push(
              event.parts
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join(""),
            );
          } else if (event.type === "session.message.chunk" && event.chunk.type === "text-delta") {
            observed.push(event.chunk.delta);
          }
        }
      });

      const cliTurn = runCli(
        [
          "run",
          "--url",
          address,
          "--project-id",
          projectId,
          "--session-id",
          created.ref.sessionId,
          "CLI_USER_ALPHA",
        ],
        env,
      );
      expect(cliTurn).toContain("user: CLI_USER_ALPHA");
      expect(cliTurn).toContain(FAKE_REPLY);

      await observer.agent.session.prompt({
        ref: created.ref,
        parts: [{ type: "text", text: "OBS_USER_GAMMA" }],
      });

      await waitFor(
        "observer saw CLI and peer prompts",
        () =>
          observed.some((line) => line.includes("CLI_USER_ALPHA")) &&
          observed.some((line) => line.includes("OBS_USER_GAMMA")) &&
          observed.some((line) => line.includes(FAKE_REPLY)),
      );
    } finally {
      observerHandle.close();
    }
  }, 60_000);
});

describe("pie run against the daemon", () => {
  let home: string;
  let workspace: string;
  let env: NodeJS.ProcessEnv;
  let projectId: string;

  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-cli-daemon-home-"));
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pie-cli-daemon-ws-"));
    env = pieEnv(home);
    runCli(["daemon", "start"], env);
    const record = readDaemonRecord(home);
    const handle = createPieClientFromEndpoint({
      address: record.address,
      token: record.token,
    });
    try {
      const project = await handle.client.project.create({ path: workspace });
      projectId = project.id;
    } finally {
      handle.close();
    }
  }, 60_000);

  afterAll(() => {
    try {
      runCli(["daemon", "stop"], env);
    } catch {
      // best-effort cleanup
    }
  });

  it("reuses the daemon without --url", () => {
    const first = runCli(["run", "--cwd", workspace, "CLI_DAEMON_A"], env);
    const second = runCli(["run", "--cwd", workspace, "CLI_DAEMON_B"], env);
    const a = parseCreated(first);
    const b = parseCreated(second);
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.projectId).toBe(projectId);
    expect(b.projectId).toBe(projectId);
  }, 60_000);

  it("reuses the daemon record token when --url matches the local daemon", () => {
    const address = parseDaemonAddress(runCli(["daemon", "status"], env));
    const created = runCli(["run", "--url", address, "--cwd", workspace, "CLI_DAEMON_URL"], env);
    expect(parseCreated(created).sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  }, 60_000);

  it("rejects --url with a wrong token and points at PIE_AUTH_TOKEN", () => {
    const address = parseDaemonAddress(runCli(["daemon", "status"], env));
    const result = runCliResult(["run", "--url", address, "--cwd", workspace, "CLI_DAEMON_AUTH"], {
      ...env,
      PIE_AUTH_TOKEN: "wrong-token-00000000-0000-0000-0000-000000000000",
    });
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(combined).toContain("401");
    expect(combined).toContain(CONNECT_HINT);
  }, 60_000);

  it("pie run against the daemon prints the live turn", () => {
    const output = runCli(["run", "--cwd", workspace, "CLI_DAEMON_RUN"], env);
    expect(output).toContain("user: CLI_DAEMON_RUN");
    expect(output).toContain(FAKE_REPLY);
    expect(output).toContain("created session");
  }, 60_000);

  it("a second client sees sessions created on the token daemon", async () => {
    const record = readDaemonRecord(home);
    const observer = createPieClientFromEndpoint({
      address: record.address,
      token: record.token,
    });
    const seen: string[] = [];
    try {
      const firehose = await observer.client.agent.session.subscribe({
        scope: { kind: "global" },
      });
      swallowAbort(async () => {
        for await (const item of firehose) {
          if (item.type === "event" && item.event.type === "session.created") {
            seen.push(item.event.ref.sessionId);
          }
        }
      });
      const created = parseCreated(runCli(["run", "--cwd", workspace, "CLI_DAEMON_PEER"], env));
      await waitFor("daemon observer session.created", () => seen.includes(created.sessionId));
      expect(seen).toContain(created.sessionId);
    } finally {
      observer.close();
    }
  }, 60_000);

  it("creates a git worktree when --worktree is set", () => {
    initGitRepo(workspace);
    const output = runCli(["run", "--cwd", workspace, "--worktree", "CLI_DAEMON_WORKTREE"], env);
    expect(output).toContain("user: CLI_DAEMON_WORKTREE");
    expect(output).toContain(FAKE_REPLY);
    expect(output).toMatch(/worktree \S+ branch pie\/[0-9a-f]{8}/);
    const created = parseCreated(output);
    expect(created.projectId).toBe(projectId);
  }, 60_000);
});

describe("pie run --url never starts a daemon", () => {
  let home: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-cli-nospawn-"));
    env = pieEnv(home);
  });

  afterAll(() => {
    try {
      runCli(["daemon", "stop"], env);
    } catch {
      // best-effort cleanup
    }
  });

  it("does not start a daemon when --url is set, even if the URL cannot be used", () => {
    const result = runCliResult(["run", "--url", "not-a-url", "CLI_NOSPAWN"], env);
    expect(result.status).not.toBe(0);
    const status = runCli(["daemon", "status"], env);
    expect(status).toContain("pie daemon is not running");
    expect(fs.existsSync(path.join(home, "daemon", "daemon.pid"))).toBe(false);
  }, 60_000);
});
