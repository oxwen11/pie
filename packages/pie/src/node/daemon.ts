import url from "node:url";

import { embeddedDaemonCompatibilityKey } from "@getpie/core/compatibility";
import { resolveOrSpawnDaemon, resolvePieHome } from "@getpie/server/daemon";

/**
 * The server entry the daemon runs. The published CLI ships `dist/server.js`
 * beside itself; source runs the server package's TypeScript entry. Pie
 * Desktop's `pie` command points this at the app's own `server.js` through
 * `PIE_SERVER_ENTRY`, read once and dropped so the daemon and its children do
 * not inherit an app-internal path.
 */
const serverEntry =
  process.env.PIE_SERVER_ENTRY ??
  url.fileURLToPath(
    new URL(
      import.meta.url.endsWith(".ts") ? "../../../server/src/http/main.ts" : "./server.js",
      import.meta.url,
    ),
  );
delete process.env.PIE_SERVER_ENTRY;

/** Spawn the server entry, detached, as the daemon. */
const serverArgv = (): string[] => [process.execPath, ...process.execArgv, serverEntry];

/** The single CLI seam for attaching to or starting its local daemon. */
export const resolveCliDaemon = (
  port: number,
  environment?: NodeJS.ProcessEnv,
  replaceIncompatible?: boolean,
) =>
  resolveOrSpawnDaemon({
    home: resolvePieHome(),
    requiredCompatibilityKey: embeddedDaemonCompatibilityKey(),
    serverArgv: serverArgv(),
    port,
    ...(environment === undefined ? undefined : { environment }),
    ...(replaceIncompatible === true ? { replaceIncompatible: true } : undefined),
  });
