import type { WithEffectContext } from "@orpc/experimental-effect";
import type { FileSystem } from "effect/FileSystem";

import type { EventBus } from "../events";
import type { FileSystemService } from "../fs";
import type { GitService } from "../git";
import type { PiAgentService, PiAgentSessionService } from "../harness";
import type { PiAgent } from "../harness/pi/agent";
import type { ProjectService } from "../project";
import type { PullRequestService } from "../pull-request";
import type { PullRequestCoordinator } from "../pull-request/coordinator";
import type { ScheduleService } from "../schedule";
import type { SettingsRepository } from "../settings";
import type { TerminalManager } from "../terminal";

/** Services every RPC procedure may `yield*`. */
export type RpcContext = WithEffectContext<
  | EventBus
  | FileSystem
  | PiAgent
  | PiAgentSessionService
  | PiAgentService
  | ProjectService
  | ScheduleService
  | SettingsRepository
  | FileSystemService
  | GitService
  | PullRequestService
  | PullRequestCoordinator
  | TerminalManager
>;
