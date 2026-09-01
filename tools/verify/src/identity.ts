import path from "node:path";

import { findRepoRoot } from "./runtime/process.ts";

export type SurfaceId = "web" | "cli" | "desktop";

export const VITE_PORT = 4190;
export const DEFAULT_CDP_PORT = 9223;

export type SampleSpec = {
  name: string;
  marker: string;
  readme: string;
  markerBody: string;
};

export type TakenPolicy = "pie" | "pie-and-vite" | "cdp";

export type SurfaceIdentity = {
  id: SurfaceId;
  skill: string;
  skillDir: string;
  root: string;
  currentLink: string;
  bin: string;
  logPrefix: string;
  defaultPiePort: number;
  foreignPorts: number[];
  forbiddenPiePorts: Readonly<Record<number, string>>;
  takenHint: string;
  takenPolicy: TakenPolicy;
  warnTaken: number[];
  pidFiles: string[];
  build: "core" | "server";
  allowServe: boolean;
  needsDisplay: boolean;
  usesDaemonDir: boolean;
  vitePort?: number;
  cdpDefault?: number;
  sample?: SampleSpec;
  browserSession?: string;
};

const WEB_4000 = "refuse PIE_PORT=4000 — that is the desktop daemon port (auth-token gated).";
const CLI_4000 = "refuse PIE_PORT=4000 — that is the user/desktop daemon port.";
const WEB_PORTS = "reserved for web verify-pie (serve 4180 / Vite 4190).";
const CLI_PORT = "reserved for verify-pie-cli.";

const webRoot = process.env.VERIFY_PIE_ROOT ?? "/tmp/pie-verify-web";
const cliRoot = process.env.VERIFY_PIE_CLI_ROOT ?? "/tmp/pie-verify-cli";
const desktopRoot = process.env.VERIFY_PIE_DESKTOP_ROOT ?? "/tmp/pie-verify-desktop";

export const WEB: SurfaceIdentity = {
  id: "web",
  skill: "verify-pie",
  skillDir:
    process.env.VERIFY_PIE_SKILL_DIR ?? path.join(findRepoRoot(), ".agents/skills/verify-pie"),
  root: webRoot,
  currentLink: path.join(webRoot, "current"),
  bin: process.env.VERIFY_PIE_BIN ?? "pie-verify web",
  logPrefix: "pie-verify web",
  defaultPiePort: 4180,
  foreignPorts: [4180, 4190],
  forbiddenPiePorts: { 4000: WEB_4000 },
  takenHint:
    "Vite is pinned to 4190 (strict). Two web instances cannot share it.\n  Do not drive a foreign pie / Vite — refuse rather than hijack.",
  takenPolicy: "pie-and-vite",
  warnTaken: [],
  pidFiles: ["pids/server.pid", "pids/vite.pid"],
  build: "core",
  allowServe: false,
  needsDisplay: false,
  usesDaemonDir: false,
  vitePort: VITE_PORT,
  sample: {
    name: "verify-pie-sample",
    marker: ".verify-pie-scaffold",
    readme: "sample project for pie verification\n",
    markerBody:
      "verify-pie scaffolding — safe to delete. Created so the import-project dialog\nlists a distinctive folder at $HOME without walking a long path.\n",
  },
  browserSession: process.env.VERIFY_PIE_BROWSER_SESSION ?? "pie-verify-web",
};

export const CLI: SurfaceIdentity = {
  id: "cli",
  skill: "verify-pie-cli",
  skillDir:
    process.env.VERIFY_PIE_CLI_SKILL_DIR ??
    path.join(findRepoRoot(), ".agents/skills/verify-pie-cli"),
  root: cliRoot,
  currentLink: path.join(cliRoot, "current"),
  bin: process.env.VERIFY_PIE_CLI_BIN ?? "pie-verify cli",
  logPrefix: "pie-verify cli",
  defaultPiePort: 4182,
  foreignPorts: [4182],
  forbiddenPiePorts: {
    4000: CLI_4000,
    4180: `refuse PIE_PORT=4180 — ${WEB_PORTS}`,
    4190: `refuse PIE_PORT=4190 — ${WEB_PORTS}`,
  },
  takenHint: "Do not attach to a foreign daemon — refuse rather than hijack.",
  takenPolicy: "pie",
  warnTaken: [],
  pidFiles: ["pids/serve.pid"],
  build: "core",
  allowServe: true,
  needsDisplay: false,
  usesDaemonDir: true,
};

export const DESKTOP: SurfaceIdentity = {
  id: "desktop",
  skill: "verify-pie-desktop",
  skillDir:
    process.env.VERIFY_PIE_DESKTOP_SKILL_DIR ??
    path.join(findRepoRoot(), ".agents/skills/verify-pie-desktop"),
  root: desktopRoot,
  currentLink: path.join(desktopRoot, "current"),
  bin: process.env.VERIFY_PIE_DESKTOP_BIN ?? "pie-verify desktop",
  logPrefix: "pie-verify desktop",
  defaultPiePort: 4000,
  foreignPorts: [4000],
  forbiddenPiePorts: {
    4180: `refuse using 4180 — ${WEB_PORTS}`,
    4190: `refuse using 4190 — ${WEB_PORTS}`,
    4182: `refuse using 4182 — ${CLI_PORT}`,
  },
  takenHint: "Do not attach to a foreign desktop / daemon — refuse rather than hijack.",
  takenPolicy: "cdp",
  warnTaken: [4000],
  pidFiles: ["pids/electron-vite.pid"],
  build: "server",
  allowServe: false,
  needsDisplay: true,
  usesDaemonDir: true,
  cdpDefault: DEFAULT_CDP_PORT,
  sample: {
    name: "verify-pie-desktop-sample",
    marker: ".verify-pie-desktop-scaffold",
    readme: "sample project for pie desktop verification\n",
    markerBody: "verify-pie-desktop scaffolding — safe to delete.\n",
  },
  browserSession: process.env.VERIFY_PIE_DESKTOP_BROWSER_SESSION ?? "pie-verify-desktop",
};

export function identityFor(id: SurfaceId): SurfaceIdentity {
  switch (id) {
    case "web":
      return WEB;
    case "cli":
      return CLI;
    case "desktop":
      return DESKTOP;
    default: {
      const exhaustive: never = id;
      void exhaustive;
      throw new Error("unknown surface");
    }
  }
}

export function userDataDir(cdpPort: number): string {
  return path.join(process.env.TMPDIR ?? "/tmp", `pie-desktop-remote-debugging-${cdpPort}`);
}

export function assertPiePortAllowed(identity: SurfaceIdentity, port: number): void {
  const message = identity.forbiddenPiePorts[port];
  if (message !== undefined) {
    throw new Error(message);
  }
}
