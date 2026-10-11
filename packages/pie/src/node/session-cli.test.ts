import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

import type { PromptPart, SessionRef, SubscribeStreamEvent } from "@getpie/contract";
import { fakePiPath } from "@getpie/test/paths";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CONNECT_HINT, createPieClientFromEndpoint } from "./connect";
import { awaitTurn, parseDuration } from "./session-cli";

const fromModuleUrl = (relative: string) => url.fileURLToPath(new URL(relative, import.meta.url));

const cliEntry = fromModuleUrl("./cli.ts");
const sourceHook = fromModuleUrl("../../../../tools/node/register-ts-hook.mjs");
const serverEntry = fromModuleUrl("../../../server/src/http/main.ts");
const sourceArgs = (entry: string, args: readonly string[]) => [
  "--experimental-transform-types",
  "--disable-warning=ExperimentalWarning",
  "--import",
  sourceHook,
  entry,
  ...args,
];
const sourceCliArgs = (args: readonly string[]) => sourceArgs(cliEntry, args);
const fakePi = fakePiPath;
const FAKE_REPLY = "CLI_FAKE_PI_REPLY";
const TEST_KEY = "githash:00000000";

const ref: SessionRef = {
  projectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  sessionId: "11111111-2222-3333-4444-555555555555",
};

describe("parseDuration", () => {
  it("parses s/m/h/ms", () => {
    expect(parseDuration("30")).toBe(30_000);
    expect(parseDuration("5s")).toBe(5_000);
    expect(parseDuration("2m")).toBe(120_000);
    expect(parseDuration("1h")).toBe(3_600_000);
    expect(parseDuration("250ms")).toBe(250);
  });
});

describe("awaitTurn", () => {
  it("returns idle on turn.ended", async () => {
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
          type: "session.turn.ended",
          turnId: "t1",
          outcome: "completed",
        },
      };
    }
    await expect(awaitTurn(stream())).resolves.toEqual({ kind: "idle" });
  });

  it("returns request on session.request.asked", async () => {
    async function* stream(): AsyncIterable<SubscribeStreamEvent> {
      yield {
        type: "event",
        event: {
          ref,
          seq: 1,
          type: "session.request.asked",
          request: {
            type: "tool",
            id: "req-1",
            toolName: "bash",
            input: {},
            actions: [{ id: "allow", label: "Allow", behavior: "allow" }],
            native: {},
          },
        },
      };
    }
    const state = await awaitTurn(stream());
    expect(state).toMatchObject({ kind: "request", requestId: "req-1" });
  });
});

function pieEnv(home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PIE_HOME: home,
    PIE_PORT: "0",
    PIE_E2E: "1",
    PIE_E2E_PI_EXECUTABLE: fakePi,
    PIE_E2E_PI_RESPONSE: FAKE_REPLY,
    PIE_DAEMON_COMPATIBILITY_KEY: TEST_KEY,
    ...extra,
  };
}

function runCliResult(args: string[], env: NodeJS.ProcessEnv) {
  return childProcess.spawnSync(process.execPath, sourceCliArgs(args), {
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

function parseRefLine(stdout: string) {
  const line = stdout
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (line === undefined) throw new Error(`no ref line in stdout:\n${stdout}`);
  if (line.includes("\t")) {
    const [sessionId, projectId] = line.split("\t");
    if (sessionId === undefined || projectId === undefined) {
      throw new Error(`bad ref line:\n${stdout}`);
    }
    return { sessionId, projectId };
  }
  return { sessionId: line, projectId: undefined };
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
      reject(new Error(`server never became ready:\n${output}`));
    }, timeoutMs);
    const onExit = (code: number | null) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}:\n${output}`));
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

describe("pie run against a live server", () => {
  let home: string;
  let workspace: string;
  let env: NodeJS.ProcessEnv;
  let address: string;
  let serve: childProcess.ChildProcess | undefined;
  let projectId: string;
  let closeObserver: (() => void) | undefined;
  const createdIds: string[] = [];
  /** Every prompt the server accepted, by session: what Pi was actually given. */
  const submitted = new Map<string, PromptPart[][]>();

  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-cli-home-"));
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pie-cli-ws-"));
    env = pieEnv(home);
    serve = childProcess.spawn(process.execPath, sourceArgs(serverEntry, []), {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    address = await waitReady(serve);
    env = { ...env, PIE_URL: address };

    const observer = createPieClientFromEndpoint({ address, token: undefined });
    closeObserver = observer.close;
    const firehose = await observer.client.session.subscribe({
      scope: { kind: "global" },
    });
    swallowAbort(async () => {
      for await (const item of firehose) {
        if (item.type !== "event") continue;
        if (item.event.type === "session.created") createdIds.push(item.event.ref.sessionId);
        if (item.event.type === "session.prompt.submitted") {
          const key = item.event.ref.sessionId;
          submitted.set(key, [...(submitted.get(key) ?? []), [...item.event.parts]]);
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
    const first = parseRefLine(runCli(["run", "--cwd", workspace, "CLI_CWD_A"], env));
    const second = parseRefLine(runCli(["run", "--cwd", workspace, "CLI_CWD_B"], env));
    expect(first.projectId).toBe(projectId);
    expect(second.projectId).toBe(projectId);
    expect(first.sessionId).not.toBe(second.sessionId);
  }, 60_000);

  it("creates a project when --cwd is not yet registered", () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "pie-cli-new-proj-"));
    const created = parseRefLine(runCli(["run", "--cwd", fresh, "CLI_NEW_CWD"], env));
    expect(created.projectId).not.toBe(projectId);
  }, 60_000);

  it("honors PIE_URL without passing --url", () => {
    const created = parseRefLine(runCli(["run", "--project-id", projectId, "CLI_PIE_URL"], env));
    expect(created.projectId).toBe(projectId);
  }, 60_000);

  it("creates sessions via the real CLI and observers see them without refetching as creator", async () => {
    const first = runCli(["run", "--url", address, "--project-id", projectId, "CLI_CREATE_A"], env);
    const second = runCli(
      ["run", "--url", address, "--project-id", projectId, "CLI_CREATE_B"],
      env,
    );
    const a = parseRefLine(first);
    const b = parseRefLine(second);
    expect(a.projectId).toBe(projectId);
    expect(b.projectId).toBe(projectId);
    expect(a.sessionId).not.toBe(b.sessionId);

    await waitFor(
      "observer session.created for both CLI sessions",
      () => createdIds.includes(a.sessionId) && createdIds.includes(b.sessionId),
    );
  }, 60_000);

  it("pie run prints ids; -q prints only sessionId; reuse keeps the same session", () => {
    const first = runCli(
      ["run", "--url", address, "--project-id", projectId, "CLI_RUN_ALPHA"],
      env,
    );
    const a = parseRefLine(first);
    expect(a.projectId).toBe(projectId);

    // fake-pi does not persist history, so logs is an empty list — still valid JSON.
    const logs = JSON.parse(
      runCli(["logs", a.sessionId, "--project-id", projectId, "--json"], env),
    ) as { messages: unknown[] };
    expect(Array.isArray(logs.messages)).toBe(true);

    const quiet = runCli(
      ["run", "-q", "--url", address, "--project-id", projectId, "CLI_RUN_BETA"],
      env,
    ).trim();
    expect(quiet).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

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
    expect(parseRefLine(followUp).sessionId).toBe(a.sessionId);
  }, 60_000);

  it("pie ls prints the session pie run just created", () => {
    const created = parseRefLine(
      runCli(
        ["run", "--no-wait", "-q", "--url", address, "--project-id", projectId, "CLI_LS"],
        env,
      ),
    );
    const listed = JSON.parse(
      runCli(["ls", "--url", address, "--project-id", projectId, "--json"], env),
    ) as Array<{ sessionId: string }>;
    expect(listed.some((session) => session.sessionId === created.sessionId)).toBe(true);
  }, 60_000);

  const flags = () => ["--url", address, "--project-id", projectId];
  const newSession = (text: string) =>
    parseRefLine(runCli(["run", "-q", "--no-wait", ...flags(), text], env)).sessionId;
  const listIds = (...extra: string[]) =>
    (
      JSON.parse(runCli(["ls", ...flags(), "--json", ...extra], env)) as Array<{
        sessionId: string;
      }>
    ).map((session) => session.sessionId);
  const lastPrompt = async (sessionId: string) => {
    await waitFor(`prompt submitted to ${sessionId}`, () => submitted.has(sessionId));
    return submitted.get(sessionId)?.at(-1) ?? [];
  };

  it("run --from submits the source selection, then the whole new prompt", async () => {
    const source = newSession("CLI_FROM_SOURCE");
    const created = parseRefLine(
      runCli(["run", "-q", "--no-wait", ...flags(), "--from", source, "CLI_FROM_NEXT"], env),
    );
    expect(created.sessionId).not.toBe(source);
    const parts = await lastPrompt(created.sessionId);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ type: "text", text: expect.stringContaining("handed off") });
    expect(parts[1]).toEqual({ type: "text", text: "CLI_FROM_NEXT" });
  }, 60_000);

  it("run --from creates nothing when the new prompt leaves no room for history", () => {
    const source = newSession("CLI_FROM_FULL");
    const before = listIds();
    const result = runCliResult(
      ["run", "-q", "--no-wait", ...flags(), "--from", source, "x".repeat(58_000)],
      env,
    );
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("does not fit");
    expect(listIds()).toEqual(before);
  }, 60_000);

  it("send --delivery and --from reach the target session", async () => {
    const source = newSession("CLI_SEND_SOURCE");
    const target = newSession("CLI_SEND_TARGET");
    runCli(["wait", target, ...flags()], env);
    runCli(["send", target, "CLI_SEND_STEER", "--delivery", "steer", "--no-wait", ...flags()], env);
    runCli(["send", target, "CLI_SEND_FROM", "--from", source, "--no-wait", ...flags()], env);
    await waitFor("both sends submitted", () => (submitted.get(target)?.length ?? 0) >= 3);
    const parts = submitted.get(target)?.at(-1) ?? [];
    expect(parts).toHaveLength(2);
    expect(parts[1]).toEqual({ type: "text", text: "CLI_SEND_FROM" });
  }, 60_000);

  it("queue replaces the whole queue and an empty call clears it", () => {
    const sessionId = newSession("CLI_QUEUE");
    const replaced = runCli(
      [
        "session",
        "queue",
        sessionId,
        "--steering",
        "one",
        "--follow-up",
        "two",
        "--follow-up",
        "three",
        ...flags(),
      ],
      env,
    );
    expect(parseRefLine(replaced).sessionId).toBe(sessionId);
    const cleared = runCli(["session", "queue", sessionId, "--json", ...flags()], env);
    expect(JSON.parse(cleared)).toMatchObject({ sessionId, ok: true });
  }, 60_000);

  it("rename, archive and --undo change what pie ls shows", () => {
    const sessionId = newSession("CLI_ARCHIVE");
    runCli(["session", "rename", sessionId, "Renamed by CLI", ...flags()], env);
    const titled = JSON.parse(runCli(["ls", ...flags(), "--json"], env)) as Array<{
      sessionId: string;
      title?: string;
    }>;
    expect(titled.find((session) => session.sessionId === sessionId)?.title).toBe("Renamed by CLI");
    runCli(["session", "archive", sessionId, ...flags()], env);
    expect(listIds()).not.toContain(sessionId);
    expect(listIds("--all")).toContain(sessionId);
    runCli(["session", "archive", sessionId, "--undo", ...flags()], env);
    expect(listIds()).toContain(sessionId);
  }, 60_000);

  it("pr link, ls and exclude keep an association without GitHub", () => {
    const sessionId = newSession("CLI_PR");
    const pr = "https://github.com/Owner/Repo/pull/7";
    expect(runCli(["pr", "link", sessionId, pr, ...flags()], env).trim()).toBe("linked");
    expect(runCli(["pr", "link", sessionId, pr, ...flags()], env).trim()).toBe("exists");
    expect(runCli(["pr", "ls", sessionId, ...flags()], env).trim()).toBe("owner/repo#7\tlinked");
    runCli(["pr", "exclude", sessionId, pr, ...flags()], env);
    expect(runCli(["pr", "ls", sessionId, ...flags()], env).trim()).toBe("owner/repo#7\texcluded");
    expect(runCli(["pr", "link", sessionId, pr, ...flags()], env).trim()).toBe("excluded");
    const bad = runCliResult(
      ["pr", "link", sessionId, "https://example.com/a/b/pull/1", ...flags()],
      env,
    );
    expect(bad.status).toBe(1);
  }, 60_000);

  it("schedule create, run, update and rm go through the schedule contract", async () => {
    const created = JSON.parse(
      runCli(
        [
          "schedule",
          "create",
          "CLI_SCHEDULE_PROMPT",
          "--name",
          "cli-sched",
          "--manual",
          "--json",
          ...flags(),
        ],
        env,
      ),
    ) as { id: string; spec: { kind: string } };
    expect(created.spec.kind).toBe("manual");
    const started = parseRefLine(runCli(["schedule", "run", created.id, "--url", address], env));
    const parts = await lastPrompt(started.sessionId);
    expect(parts).toEqual([{ type: "text", text: "CLI_SCHEDULE_PROMPT" }]);
    expect(runCli(["schedule", "list", "-q", "--url", address], env)).toContain(created.id);
    const updated = JSON.parse(
      runCli(
        [
          "schedule",
          "update",
          created.id,
          "--every",
          "5m",
          "--disable",
          "--json",
          "--url",
          address,
        ],
        env,
      ),
    ) as { enabled: boolean; spec: { kind: string } };
    expect(updated).toMatchObject({ enabled: false, spec: { kind: "every" } });
    runCli(["schedule", "rm", created.id, "--url", address], env);
    expect(runCli(["schedule", "list", "-q", "--url", address], env)).not.toContain(created.id);
  }, 60_000);

  it("project create registers a directory and project ls lists it", () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "pie-cli-project-"));
    const id = runCli(["project", "create", fresh, "-q", "--url", address], env).trim();
    expect(runCli(["project", "ls", "-q", "--url", address], env).split("\n")).toContain(id);
    expect(runCli(["project", "create", fresh, "-q", "--url", address], env).trim()).toBe(id);
  }, 60_000);

  it("pie mcp refuses an unauthenticated server", () => {
    const result = runCliResult(["mcp", "--url", address], env);
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("authenticated daemon");
  }, 60_000);

  it("supports --no-wait then wait/send", () => {
    const created = parseRefLine(
      runCli(
        ["run", "--no-wait", "-q", "--url", address, "--project-id", projectId, "CLI_BG"],
        env,
      ),
    );
    const waited = runCli(
      ["wait", created.sessionId, "--project-id", projectId, "--timeout", "30s"],
      env,
    ).trim();
    expect(waited).toBe("idle");

    const sent = parseRefLine(
      runCli(
        ["send", created.sessionId, "CLI_SEND", "--project-id", projectId, "--timeout", "30s"],
        env,
      ),
    );
    expect(sent.sessionId).toBe(created.sessionId);

    const interrupted = parseRefLine(
      runCli(["interrupt", created.sessionId, "--project-id", projectId], env),
    );
    expect(interrupted.sessionId).toBe(created.sessionId);
  }, 60_000);

  it("syncs prompts both ways over the session subscribe stream", async () => {
    const observerHandle = createPieClientFromEndpoint({ address, token: undefined });
    try {
      const observer = observerHandle.client;
      const created = await observer.session.create({ projectId });
      const observed: string[] = [];
      const stream = await observer.session.subscribe({
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

      runCli(
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

      await observer.session.send({
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
      expect(observed).toEqual(
        expect.arrayContaining([
          expect.stringContaining("CLI_USER_ALPHA"),
          expect.stringContaining("OBS_USER_GAMMA"),
          expect.stringContaining(FAKE_REPLY),
        ]),
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
    const a = parseRefLine(first);
    const b = parseRefLine(second);
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.projectId).toBe(projectId);
    expect(b.projectId).toBe(projectId);
  }, 60_000);

  it("reuses the daemon record token when --url matches the local daemon", () => {
    const address = parseDaemonAddress(runCli(["daemon", "status"], env));
    const created = runCli(["run", "--url", address, "--cwd", workspace, "CLI_DAEMON_URL"], env);
    expect(parseRefLine(created).sessionId).toMatch(
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

  it("pie run against the daemon prints ids and settles", () => {
    const output = runCli(["run", "--cwd", workspace, "CLI_DAEMON_RUN"], env);
    const created = parseRefLine(output);
    expect(created.projectId).toBe(projectId);
    const waited = runCli(
      ["wait", created.sessionId, "--project-id", projectId, "--timeout", "10s"],
      env,
    ).trim();
    expect(waited).toBe("idle");
  }, 60_000);

  it("a second client sees sessions created on the token daemon", async () => {
    const record = readDaemonRecord(home);
    const observer = createPieClientFromEndpoint({
      address: record.address,
      token: record.token,
    });
    const seen: string[] = [];
    try {
      const firehose = await observer.client.session.subscribe({
        scope: { kind: "global" },
      });
      swallowAbort(async () => {
        for await (const item of firehose) {
          if (item.type === "event" && item.event.type === "session.created") {
            seen.push(item.event.ref.sessionId);
          }
        }
      });
      const created = parseRefLine(runCli(["run", "--cwd", workspace, "CLI_DAEMON_PEER"], env));
      await waitFor("daemon observer session.created", () => seen.includes(created.sessionId));
      expect(seen).toContain(created.sessionId);
    } finally {
      observer.close();
    }
  }, 60_000);

  it("creates a git worktree when --worktree is set", () => {
    initGitRepo(workspace);
    const output = runCli(
      ["run", "--json", "--cwd", workspace, "--worktree", "CLI_DAEMON_WORKTREE"],
      env,
    );
    const payload = JSON.parse(output) as {
      sessionId: string;
      projectId: string;
      worktree?: { cwd: string; branch: string };
    };
    expect(payload.projectId).toBe(projectId);
    expect(payload.worktree?.branch).toMatch(/^pie\/[0-9a-f]{8}$/);
    expect(payload.worktree?.cwd).toBeTruthy();
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
  }, 60_000);

  it("does not start a daemon when --url is set, even if the URL cannot be used", () => {
    const result = runCliResult(["run", "--url", "not-a-url", "CLI_NOSPAWN"], env);
    expect(result.status).not.toBe(0);
    const status = runCli(["daemon", "status"], env);
    expect(status).toContain("pie daemon is not running");
    expect(fs.existsSync(path.join(home, "daemon", "daemon.pid"))).toBe(false);
  }, 60_000);
});
