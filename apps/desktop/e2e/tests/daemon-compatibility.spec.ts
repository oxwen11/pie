import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { type ElectronApplication, _electron as electron, expect, test } from "@playwright/test";

import { seedProject, stopDaemonFor, stopProcess } from "./fixtures.js";

const LEGACY_SERVER = `
import fs from "node:fs";
import http from "node:http";
const portFile = process.env.PIE_TEST_PORT_FILE;
const server = http.createServer((request, response) => {
  if (request.url === "/api/health") return response.end("ok");
  if (
    request.method === "POST" &&
    request.url === "/api/ws-ticket" &&
    request.headers.authorization === "Bearer legacy-token"
  ) {
    response.setHeader("content-type", "application/json");
    return response.end(JSON.stringify({ ticket: "legacy-ticket" }));
  }
  response.statusCode = 404;
  response.end();
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  fs.writeFileSync(portFile, String(address.port));
});
`;

async function waitForFile(file: string): Promise<string> {
  await expect.poll(() => fs.existsSync(file), { timeout: 10_000 }).toBe(true);
  return fs.readFileSync(file, "utf8");
}

async function waitForConnectedUi(
  appPath: string,
  userData: string,
  pieHome: string,
): Promise<ElectronApplication> {
  const fakePiPath = path.join(import.meta.dirname, "../../../../tools/testing/fake-pi.mjs");
  const packagedExecutable = process.env.PIE_E2E_EXECUTABLE;
  const app = await electron.launch({
    ...(packagedExecutable === undefined ? undefined : { executablePath: packagedExecutable }),
    args:
      packagedExecutable === undefined
        ? [appPath, `--user-data-dir=${userData}`]
        : [`--user-data-dir=${userData}`],
    env: {
      ...process.env,
      NODE_ENV: "test",
      PIE_E2E: "1",
      PIE_E2E_PI_EXECUTABLE: fakePiPath,
      PIE_HOME: pieHome,
      PIE_DAEMON_DIR: path.join(pieHome, "daemon"),
    },
  });
  try {
    const window = await app.firstWindow({ timeout: 30_000 });
    await expect(window.locator("#root")).toBeVisible({ timeout: 30_000 });
    await expect(window.getByRole("combobox").filter({ hasText: "Select a project" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(window.getByText("Pie could not start")).toHaveCount(0);
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

// oxlint-disable-next-line no-empty-pattern -- required by Playwright's fixture API
test("a new Desktop build replaces a legacy daemon once in an isolated home", async ({}, testInfo) => {
  const root = testInfo.outputPath();
  const pieHome = path.join(root, "pie-home");
  const daemonDir = path.join(pieHome, "daemon");
  const workspace = path.join(root, "workspace");
  const portFile = path.join(root, "legacy-port");
  const legacyEntry = path.join(root, "legacy-server.mjs");
  const appPath = path.join(import.meta.dirname, "../../dist/main/index.js");
  fs.mkdirSync(daemonDir, { recursive: true });
  seedProject(pieHome, workspace);
  fs.writeFileSync(legacyEntry, LEGACY_SERVER);

  const legacy = childProcess.spawn(process.execPath, [legacyEntry], {
    env: { ...process.env, PIE_TEST_PORT_FILE: portFile },
    stdio: "ignore",
  });
  const legacyPid = legacy.pid;
  if (legacyPid === undefined) throw new Error("Legacy daemon has no pid");

  let firstApp: ElectronApplication | undefined;
  let secondApp: ElectronApplication | undefined;
  try {
    const port = Number(await waitForFile(portFile));
    fs.writeFileSync(
      path.join(daemonDir, "daemon.pid"),
      JSON.stringify({
        pid: legacyPid,
        address: `http://127.0.0.1:${port}`,
        token: "legacy-token",
        startedAt: 0,
      }),
      { mode: 0o600 },
    );

    firstApp = await waitForConnectedUi(appPath, path.join(root, "user-data-first"), pieHome);
    const replacement = JSON.parse(fs.readFileSync(path.join(daemonDir, "daemon.pid"), "utf8")) as {
      pid: number;
      compatibilityKey?: string;
    };
    expect(replacement.pid).not.toBe(legacyPid);
    const expectedCompatibilityKey = process.env.PIE_E2E_EXPECTED_COMPATIBILITY_KEY;
    if (expectedCompatibilityKey === undefined) {
      expect(replacement.compatibilityKey).toMatch(/^githash:[0-9a-f]{8}$/);
    } else {
      expect(replacement.compatibilityKey).toBe(expectedCompatibilityKey);
    }
    expect(() => process.kill(legacyPid, 0)).toThrow();

    await firstApp.close();
    firstApp = undefined;

    secondApp = await waitForConnectedUi(appPath, path.join(root, "user-data-second"), pieHome);
    const relaunched = JSON.parse(fs.readFileSync(path.join(daemonDir, "daemon.pid"), "utf8")) as {
      pid: number;
      compatibilityKey?: string;
    };
    expect(relaunched.pid).toBe(replacement.pid);
    expect(relaunched.compatibilityKey).toBe(replacement.compatibilityKey);
  } finally {
    await firstApp?.close();
    await secondApp?.close();
    await stopDaemonFor(pieHome);
    await stopProcess(legacyPid);
  }
});
