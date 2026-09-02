import { assertPiePortAllowed, type SurfaceIdentity } from "../identity.ts";
import { envPort, listenPids } from "../runtime/process.ts";
import type { PortPlan } from "../surface.ts";

export function portPlan(identity: SurfaceIdentity): PortPlan {
  const piePort = envPort("PIE_PORT", identity.defaultPiePort);
  switch (identity.id) {
    case "web":
      return {
        piePort,
        refuseTaken: [piePort, identity.vitePort],
        warnTaken: identity.warnTaken,
      };
    case "cli":
      return {
        piePort,
        refuseTaken: [piePort],
        warnTaken: identity.warnTaken,
      };
    case "desktop": {
      const cdpPort = envPort("PIE_REMOTE_DEBUG_PORT", identity.cdpDefault);
      return {
        piePort,
        refuseTaken: [cdpPort],
        warnTaken: identity.warnTaken,
      };
    }
    default: {
      const exhaustive: never = identity;
      void exhaustive;
      throw new Error("unknown surface");
    }
  }
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
