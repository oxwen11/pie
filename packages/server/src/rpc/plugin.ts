import { pluginContract } from "@getpie/contract/plugin";

import { Paths } from "../config/paths";
import { listPanelPlugins } from "../plugin";
import type { RpcContext } from "./context";
import { implement } from "./orpc";

const orpc = implement(pluginContract).$context<RpcContext>();

export const pluginRouter = orpc.router({
  list: orpc.list.effect(function* () {
    const { pluginsDir } = yield* Paths;
    return yield* listPanelPlugins(pluginsDir);
  }),
});
