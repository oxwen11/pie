import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** The one seeded project's id — the contract validates projectId as a UUID. */
export const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

export function repoRoot(): string {
  return path.join(import.meta.dirname, "../..");
}

export function fakePiPath(): string {
  return path.join(import.meta.dirname, "fake-pi.mjs");
}

export function appDistDir(): string {
  return path.join(repoRoot(), "apps/app/dist");
}

export function appDistExists(): boolean {
  return fs.existsSync(path.join(appDistDir(), "index.html"));
}

/**
 * Seed one project into a `$PIE_HOME`: a fresh home renders the first-project
 * onboarding instead of the composer, so chat flows need a project up front.
 */
export function seedProject(pieHome: string, workspace: string): void {
  fs.mkdirSync(workspace, { recursive: true });
  const storage = path.join(pieHome, "storage");
  fs.mkdirSync(storage, { recursive: true });
  fs.writeFileSync(
    path.join(storage, "projects.json"),
    JSON.stringify({
      version: 1,
      data: [
        {
          id: PROJECT_ID,
          name: "e2e-workspace",
          path: workspace,
          createdAt: "2026-08-03T00:00:00.000Z",
        },
      ],
    }),
  );
}

/** Env for `pie serve` (or Electron) under the fake-pi harness. */
export function pieE2eEnv(options: {
  pieHome: string;
  fakePiLog?: string;
  fakePiResponse?: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PIE_PORT: "0",
    PIE_HOME: options.pieHome,
    PIE_E2E: "1",
    PIE_E2E_PI_EXECUTABLE: fakePiPath(),
  };
  // Foreground serve is unauthenticated. A leftover desktop token would 401
  // `/api/ws-ticket` and the browser client would never connect.
  delete env.PIE_AUTH_TOKEN;
  if (options.fakePiLog !== undefined) env.PIE_E2E_PI_LOG = options.fakePiLog;
  if (options.fakePiResponse !== undefined) env.PIE_E2E_PI_RESPONSE = options.fakePiResponse;
  return env;
}

export type PieServe = {
  readonly baseUrl: string;
  readonly port: number;
  readonly stop: () => void;
};

/**
 * Spawn `packages/pie` `serve` via tsx, wait for `pie:ready`, and return the
 * loopback origin. The process serves `apps/app/dist` statically — build first.
 */
export async function startPieServe(options: {
  pieHome: string;
  fakePiLog?: string;
  fakePiResponse?: string;
  timeoutMs?: number;
}): Promise<PieServe> {
  const root = repoRoot();
  const server = childProcess.spawn(
    path.join(root, "node_modules/.bin/tsx"),
    [path.join(root, "packages/pie/src/node/cli.ts"), "serve"],
    {
      env: pieE2eEnv(options),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const timeoutMs = options.timeoutMs ?? 30_000;
  const { port } = await new Promise<{ port: number }>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => reject(new Error(`pie serve never became ready:\n${output}`)),
      timeoutMs,
    );
    const scan = (chunk: Buffer) => {
      output += chunk.toString();
      const ready = output.match(/pie:ready\s*({.+})/);
      if (ready?.[1]) {
        clearTimeout(timeout);
        resolve(JSON.parse(ready[1]) as { port: number });
      }
    };
    server.stdout.on("data", scan);
    server.stderr.on("data", scan);
    server.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`pie serve exited with ${code}:\n${output}`));
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    stop: () => {
      server.kill("SIGTERM");
    },
  };
}
