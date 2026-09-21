import { embeddedDaemonCompatibilityKey } from "@getpie/core/compatibility";
import {
  resolveOrSpawnDaemon,
  resolvePieHome,
  type ResolveDaemonOptions,
} from "@getpie/server/daemon";

/** Re-launch this CLI in foreground `serve` mode as the detached daemon. */
const serverArgv = (): string[] => [
  process.execPath,
  ...process.execArgv,
  process.argv[1] ?? "",
  "serve",
];

/** The single CLI seam for attaching to or starting its local daemon. */
export const resolveCliDaemon = (port: number, environment?: NodeJS.ProcessEnv) => {
  let options: ResolveDaemonOptions = {
    home: resolvePieHome(),
    requiredCompatibilityKey: embeddedDaemonCompatibilityKey(),
    serverArgv: serverArgv(),
    port,
  };
  if (environment !== undefined) options = { ...options, environment };
  return resolveOrSpawnDaemon(options);
};
