export { SshPasswordPrompt, isSshAuthFailure } from "./auth";
export type { SshPasswordPromptShape, SshPasswordRequest } from "./auth";
export {
  baseSshArgs,
  redactSshErrorOutput,
  resolveSshInput,
  resolveSshTarget,
  runSshCommand,
  sshCommandForPlatform,
  SSH_UNSET_ENV_KEYS,
  sshSpawnEnv,
} from "./command";
export type { RunSshCommandOptions, SshCommandResult } from "./command";
export { discoverSshHosts } from "./config";
export {
  SshCommandError,
  SshHostDiscoveryError,
  SshInvalidTargetError,
  SshLaunchError,
  SshPasswordPromptError,
  SshReadinessError,
} from "./errors";
export type { SshEnvironmentError } from "./errors";
export {
  buildRemoteLaunchScript,
  buildRemotePieRunnerScript,
  DEFAULT_NODE_ENGINE_RANGE,
  DEFAULT_REMOTE_PORT,
  REMOTE_LAUNCH_TIMEOUT_MS,
  SSH_READY_TIMEOUT_MS,
} from "./scripts";
export {
  buildSshHostSpec,
  environmentLabel,
  extractJsonObject,
  formatSshInput,
  overlaySshTarget,
  parseRemoteLaunchOutput,
  parseSshInput,
  parseSshResolveOutput,
  remoteStateKey,
  targetConnectionKey,
} from "./target";
export type {
  DiscoveredSshHost,
  RemoteLaunchResult,
  RemoteServerKind,
  SshEnvironmentBootstrap,
  SshTarget,
} from "./target";
export {
  connectSshEnvironment,
  forwardedConnection,
  launchOrReuseRemoteServer,
  LOCAL_FORWARD_HOST,
  reserveLoopbackPort,
  startSshTunnel,
  waitForForwardedDaemon,
  waitForHttpReady,
} from "./tunnel";
export type { SshConnectedEnvironment, SshForwardedConnection, SshTunnel } from "./tunnel";
