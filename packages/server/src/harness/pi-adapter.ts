import { Context, Layer } from "effect";

import type { HarnessAgentAdapter } from "./adapter";

/** The Pi session driver — sole agent adapter for the server runtime. */
export class PiAdapter extends Context.Service<PiAdapter, HarnessAgentAdapter>()("PiAdapter") {}

export const PiAdapterLayer = (adapter: HarnessAgentAdapter): Layer.Layer<PiAdapter> =>
  Layer.succeed(PiAdapter, adapter);
