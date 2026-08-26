export {
  findTailscaleCommand,
  isTailscaleSpawnNotFound,
  probeTailscaleClient,
  requireTailscaleCommand,
  runTailscaleCommand,
  stderrDiagnosticOf,
  TAILSCALE_SERVE_TIMEOUT_MS,
  TAILSCALE_STATUS_TIMEOUT_MS,
  tailscaleClientMissingMessage,
  tailscaleCommandForPlatform,
  tailscaleExitUserMessage,
} from "./command";
export type {
  FindTailscaleCommandOptions,
  TailscaleClientAvailability,
  TailscaleCommandResult,
} from "./command";
export {
  TailscaleClientMissingError,
  TailscaleCommandError,
  TailscaleStatusParseError,
} from "./errors";
export type { TailscaleEnvironmentError, TailscaleStderrDiagnostic } from "./errors";
export {
  buildTailscaleHttpsBaseUrl,
  DEFAULT_TAILSCALE_SERVE_PORT,
  disableTailscaleServe,
  ensureTailscaleServe,
  tailscaleServeDisableArgs,
  tailscaleServeEnableArgs,
} from "./serve";
export {
  decodeTailscaleStatus,
  isTailscaleIpv4Address,
  listOnlineTailscaleSshHosts,
  parseTailscaleStatus,
  readTailscaleStatus,
  stripTrailingDnsDot,
} from "./status";
export type { TailscalePeerHost, TailscaleStatus } from "./status";
