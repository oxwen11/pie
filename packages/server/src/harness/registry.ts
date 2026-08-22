import { Context, Layer } from "effect";

import type { HarnessAgentAdapter } from "./adapter";

export type HarnessAgentRegistryShape = {
  readonly adapter: HarnessAgentAdapter;
};

export class HarnessAgentRegistry extends Context.Service<
  HarnessAgentRegistry,
  HarnessAgentRegistryShape
>()("HarnessAgentRegistry") {}

export const makeHarnessAgentRegistry = (
  adapter: HarnessAgentAdapter,
): HarnessAgentRegistryShape => ({
  adapter,
});

export const HarnessAgentRegistryLayer = (
  adapter: HarnessAgentAdapter,
): Layer.Layer<HarnessAgentRegistry> =>
  Layer.succeed(HarnessAgentRegistry, makeHarnessAgentRegistry(adapter));
