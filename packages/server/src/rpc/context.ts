import type { WithEffectContext } from "@orpc/experimental-effect";
import type { FileSystem } from "effect/FileSystem";

import type { AutomationService } from "../automation";
import type { EventBus } from "../events";
import type { FileSystemService } from "../fs";
import type { GitService } from "../git";
import type { PiAgentService, PiAgentSessionService } from "../harness";
import type { PiAgent } from "../harness/pi/agent";
import type { ProjectService } from "../project";
import type { PullRequestService } from "../pull-request";

/** Services every RPC procedure may `yield*`. */
export type RpcContext = WithEffectContext<
  | EventBus
  | FileSystem
  | PiAgent
  | PiAgentSessionService
  | PiAgentService
  | ProjectService
  | AutomationService
  | FileSystemService
  | GitService
  | PullRequestService
>;
