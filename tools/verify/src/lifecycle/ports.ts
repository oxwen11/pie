import { DEFAULT_CDP_PORT, assertPiePortAllowed, type SurfaceIdentity } from "../identity.ts";
import { envPort, listenPids } from "../runtime/process.ts";
import type { PortPlan } from "../surface.ts";

export function portPlan(identity: SurfaceIdentity): PortPlan {
  const piePort = envPort("PIE_PORT", identity.defaultPiePort);
  const vitePort = identity.vitePort;
  const cdpPort =
    identity.cdpDefault === undefined
      ? undefined
      : envPort("PIE_REMOTE_DEBUG_PORT", identity.cdpDefault ?? DEFAULT_CDP_PORT);
  const refuseTaken: number[] = [];
  switch (identity.takenPolicy) {
    case "pie":
      refuseTaken.push(piePort);
      break;
    case "pie-and-vite":
      if (vitePort === undefined) {
        throw new Error("pie-and-vite policy requires vitePort");
      }
      refuseTaken.push(piePort, vitePort);
      break;
    case "cdp":
      if (cdpPort === undefined) {
        throw new Error("cdp policy requires cdpDefault");
      }
      refuseTaken.push(cdpPort);
      break;
    default: {
      const exhaustive: never = identity.takenPolicy;
      void exhaustive;
    }
  }
  return { piePort, vitePort, cdpPort, refuseTaken, warnTaken: identity.warnTaken };
}

export function applyPortPlan(identity: SurfaceIdentity, plan: PortPlan): void {
  assertPiePortAllowed(identity, plan.piePort);
  for (const port of plan.warnTaken) {
    if (listenPids(port).length > 0) {
      console.error(
        `${identity.logPrefix}: port ${port} is taken; daemon will pick an ephemeral port (isolated PIE_HOME).`,
      );
    }
  }
  for (const port of plan.refuseTaken) {
    const pids = listenPids(port);
    if (pids.length > 0) {
      throw new Error(
        `port ${port} is already taken by pid(s): ${pids.join(" ")}\n  ${identity.takenHint}`,
      );
    }
  }
}
