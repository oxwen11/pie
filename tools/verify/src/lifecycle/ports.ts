import type { SurfaceIdentity } from "../identity.ts";
import { assertPiePortAllowed } from "../identity.ts";
import { listenPids } from "../runtime/process.ts";
import type { PortPlan } from "../surface.ts";

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
