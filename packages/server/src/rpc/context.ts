import type { WithEffectContext } from "@orpc/experimental-effect";
import type { FileSystem } from "effect/FileSystem";

import type { EventBus } from "../events";
import type { FileSystemService } from "../fs";
import type { GitService } from "../git";
import type { PiAgentSessionService } from "../harness";
import type { PiAgent } from "../harness/pi/agent";
import type { SessionMetadata } from "../harness/session-metadata";
import type { PackageService } from "../packages";
import type { ProjectService } from "../project";
import type { PullRequestService } from "../pull-request";
import type { ScheduleService } from "../schedule";
import type { SettingsRepository } from "../settings";
import type { SkillService } from "../skills";
import type { TerminalManager } from "../terminal";

/** Services every RPC procedure may `yield*`. */
export type RpcContext = WithEffectContext<
  | EventBus
  | FileSystem
  | PiAgent
  | PiAgentSessionService
  | SessionMetadata
  | PackageService
  | ProjectService
  | SkillService
  | ScheduleService
  | SettingsRepository
  | FileSystemService
  | GitService
  | PullRequestService
  | TerminalManager
>;
