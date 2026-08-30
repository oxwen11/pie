import type { WithEffectContext } from "@orpc/experimental-effect";
import type { FileSystem } from "effect/FileSystem";

import type { SessionImageAssets } from "../assets";
import type { EventBus } from "../events";
import type { FileSystemService } from "../fs";
import type { GitService } from "../git";
import type { PiAgentService, PiAgentSessionService } from "../harness";
import type { PiAgent } from "../harness/pi/agent";
import type { ProjectService } from "../project";

/** Services every RPC procedure may `yield*`. */
export type RpcContext = WithEffectContext<
  | EventBus
  | SessionImageAssets
  | FileSystem
  | PiAgent
  | PiAgentSessionService
  | PiAgentService
  | ProjectService
  | FileSystemService
  | GitService
>;
