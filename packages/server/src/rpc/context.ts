import type { WithEffectContext } from "@orpc/experimental-effect";
import type { FileSystem } from "effect/FileSystem";

import type { EventBus } from "../events";
import type { FileSystemService } from "../fs";
import type { HarnessAgentSessionService } from "../harness";
import type { PiAdapter } from "../harness/pi-adapter";
import type { ProjectService } from "../project";

/** Services every RPC procedure may `yield*`. */
export type RpcContext = WithEffectContext<
  | EventBus
  | FileSystem
  | PiAdapter
  | HarnessAgentSessionService
  | ProjectService
  | FileSystemService
>;
