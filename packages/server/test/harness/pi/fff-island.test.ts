import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

import { describe, it } from "vitest";

import { copyFffIsland } from "../../../scripts/copy-fff";
import { fffNodePathEnv } from "../../../src/harness/pi/fff";

const processBundle = url.fileURLToPath(
  new URL("../../../dist/pi-process/pi-process.js", import.meta.url),
);
const builtIsland = url.fileURLToPath(new URL("../../../dist/fff", import.meta.url));
const bun = process.env.PIE_BUN?.trim() ?? "bun";

const readJsonl = (text: string): Array<Record<string, unknown>> => {
  const frames: Array<Record<string, unknown>> = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null) {
        frames.push(parsed as Record<string, unknown>);
      }
    } catch {
      /* banner */
    }
  }
  return frames;
};

describe("bundled fff island", () => {
  it("copies pi-fff and one platform bin, then overrides find/grep under Bun", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-island-"));
    copyFffIsland(dest);
    const island = path.join(dest, "node_modules");
    assert.equal(fs.existsSync(path.join(island, "@ff-labs", "pi-fff", "src", "index.ts")), true);
    const bins = fs
      .readdirSync(path.join(island, "@ff-labs"))
      .filter((name) => name.startsWith("fff-bin-"));
    assert.equal(bins.length, 1);

    const home = path.join(dest, "home");
    const cwd = path.join(dest, "workspace");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(path.join(cwd, "alpha.ts"), "export const ALPHA = 1;\n");
    fs.writeFileSync(path.join(cwd, "beta.md"), "needle-fff-proof\n");
    const script = path.join(dest, "prove-pi-fff.ts");
    fs.writeFileSync(
      script,
      `import assert from "node:assert/strict";
import path from "node:path";
const island = ${JSON.stringify(island)};
const cwd = ${JSON.stringify(cwd)};
assert.ok(globalThis.Bun);
const { default: fffExtension } = await import(
  path.join(island, "@ff-labs", "pi-fff", "src", "index.ts")
);
const registeredTools = [];
const flags = new Map([
  ["fff-mode", "override"],
  ["fff-follow-symlinks", false],
  ["fff-enable-home-scan", false],
]);
const handlers = new Map();
const pi = {
  registerFlag() {},
  getFlag(name) { return flags.get(name); },
  registerTool(tool) { registeredTools.push(tool); },
  registerCommand() {},
  getActiveTools() { return registeredTools.map((tool) => tool.name); },
  setActiveTools() {},
  appendEntry() {},
  on(event, handler) { handlers.set(event, handler); },
};
fffExtension(pi);
await handlers.get("session_start")({}, {
  cwd,
  ui: { notify() {}, setStatus() {}, addAutocompleteProvider() {} },
  sessionManager: { getEntries: () => [] },
});
const names = registeredTools.map((tool) => tool.name);
assert.deepEqual(new Set(names), new Set(["find", "grep"]));
const find = registeredTools.find((tool) => tool.name === "find");
const grep = registeredTools.find((tool) => tool.name === "grep");
const findResult = await find.execute("t1", { pattern: "alpha" }, undefined);
assert.match(findResult.content.find((part) => part.type === "text")?.text ?? "", /alpha\\.ts/);
const grepResult = await grep.execute("t2", { pattern: "needle-fff-proof" }, undefined);
assert.match(grepResult.content.find((part) => part.type === "text")?.text ?? "", /beta\\.md/);
console.log("PI_FFF_OVERRIDE_OK");
`,
    );

    const run = childProcess.spawnSync(bun, ["--no-install", script], {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...process.env,
        NODE_PATH: [island, process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
        HOME: home,
      },
    });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /PI_FFF_OVERRIDE_OK/);
  }, 30_000);

  it("loads the sibling island from pie-pi-process without inlining fff-bun", async () => {
    assert.equal(fs.existsSync(processBundle), true);
    const processJs = fs.readFileSync(processBundle, "utf8");
    assert.ok(!processJs.includes("@ff-labs/fff-bun"));
    assert.ok(!processJs.includes("bun:ffi"));
    assert.ok(!processJs.includes("fffFileAnnotation"));
    assert.equal(
      fs.existsSync(
        path.join(builtIsland, "node_modules", "@ff-labs", "pi-fff", "src", "index.ts"),
      ),
      true,
    );

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-session-"));
    const runtimeDir = path.join(root, "pi-process");
    const islandDir = path.join(root, "fff");
    const workspace = path.join(root, "workspace");
    const toolsOut = path.join(root, "fff-tools.json");
    fs.cpSync(path.dirname(processBundle), runtimeDir, { recursive: true });
    fs.cpSync(builtIsland, islandDir, { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });
    fs.mkdirSync(path.join(root, "extensions"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "alpha.ts"), "export const ALPHA = 1;\n");
    fs.writeFileSync(
      path.join(root, "extensions", "fff-tools-probe.ts"),
      `import fs from "node:fs";
export default function (pi) {
  const dump = () => {
    fs.writeFileSync(process.env.PIE_FFF_TOOLS_OUT ?? "", JSON.stringify({
      tools: pi.getActiveTools(),
    }));
  };
  pi.on("session_start", () => {
    dump();
    setInterval(dump, 50).unref?.();
  });
}
`,
    );

    const script = path.join(runtimeDir, "pi-process.js");
    const child = childProcess.spawn(bun, ["--no-install", script, "--mode", "rpc"], {
      cwd: workspace,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        PI_CODING_AGENT_DIR: root,
        PI_OFFLINE: "1",
        PIE_FFF_TOOLS_OUT: toolsOut,
        ...fffNodePathEnv({ PATH: process.env.PATH, HOME: root }, script),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const commands = await new Promise<Array<{ name: string }>>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`get_commands timed out\n${stdout}\n${stderr}`));
      }, 20_000);
      child.stdout.on("data", () => {
        const frame = readJsonl(stdout).find((entry) => entry.command === "get_commands");
        if (frame === undefined) return;
        clearTimeout(timer);
        if (frame.success !== true) {
          reject(new Error(`get_commands failed: ${JSON.stringify(frame)}\n${stderr}`));
          return;
        }
        const data = frame.data as { commands?: Array<{ name: string }> } | undefined;
        resolve(data?.commands ?? []);
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code !== null && code !== 0) {
          clearTimeout(timer);
          reject(new Error(`pie-pi-process exited ${String(code)}\n${stdout}\n${stderr}`));
        }
      });
      child.stdin.write('{"id":"1","type":"get_commands"}\n');
    });

    const names = new Set(commands.map((command) => command.name));
    assert.ok(names.has("fff-mode"), `${stdout}\n${stderr}`);

    let dumped: { tools: string[] } | undefined;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (fs.existsSync(toolsOut)) {
        dumped = JSON.parse(fs.readFileSync(toolsOut, "utf8")) as { tools: string[] };
        if (dumped.tools.includes("find") && dumped.tools.includes("grep")) break;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
      });
    }
    child.kill("SIGTERM");

    assert.ok(dumped, `fff tools dump missing\n${stdout}\n${stderr}`);
    assert.ok(dumped.tools.includes("find"));
    assert.ok(dumped.tools.includes("grep"));
    assert.ok(!dumped.tools.includes("fffind"));
  }, 30_000);

  it("exits when the sibling island is missing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-missing-"));
    const runtimeDir = path.join(root, "pi-process");
    fs.cpSync(path.dirname(processBundle), runtimeDir, { recursive: true });
    const run = childProcess.spawnSync(
      bun,
      ["--no-install", path.join(runtimeDir, "pi-process.js"), "--mode", "rpc"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
        env: {
          PATH: process.env.PATH,
          HOME: root,
          PI_CODING_AGENT_DIR: root,
          PI_OFFLINE: "1",
        },
        input: '{"id":"1","type":"get_commands"}\n',
      },
    );
    assert.notEqual(run.status, 0);
    assert.match(`${run.stdout}\n${run.stderr}`, /bundled fff island missing/);
  }, 15_000);
});
