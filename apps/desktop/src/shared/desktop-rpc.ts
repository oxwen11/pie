import { asyncIteratorObject } from "@orpc/contract";
import { Schema } from "effect";

import { oc, toStandardSchema } from "./orpc";

// Value-imported from Main only. The renderer must `import type` from this
// file so the Effect Schema runtime stays out of the window bundle.

export const ServerStatusSchema = Schema.Literals(["starting", "ready", "reconnecting", "failed"]);
export type ServerStatus = typeof ServerStatusSchema.Type;

export const ServerStatusSnapshotSchema = Schema.Struct({
  revision: Schema.Natural,
  status: ServerStatusSchema,
});
export type ServerStatusSnapshot = typeof ServerStatusSnapshotSchema.Type;

export const ServerConnectionSchema = Schema.Struct({
  httpBaseUrl: Schema.String,
  wsBaseUrl: Schema.String,
  token: Schema.NonEmptyString,
});
export type ServerConnection = typeof ServerConnectionSchema.Type;

/** The three desktop targets, normalized off `process.platform`. */
export const DesktopOsSchema = Schema.Literals(["macos", "windows", "linux"]);
export type DesktopOs = typeof DesktopOsSchema.Type;

export const LOCAL_ENVIRONMENT_ID = "local";

export const SshRemoteStatusSchema = Schema.Literals(["idle", "connecting", "ready", "error"]);
export type SshRemoteStatus = typeof SshRemoteStatusSchema.Type;

export const SshRemoteEnvironmentSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  label: Schema.NonEmptyString,
  alias: Schema.NonEmptyString,
  status: SshRemoteStatusSchema,
  error: Schema.optionalKey(Schema.String),
});
export type SshRemoteEnvironment = typeof SshRemoteEnvironmentSchema.Type;

export const EnvironmentSnapshotSchema = Schema.Struct({
  revision: Schema.Natural,
  activeId: Schema.NonEmptyString,
  connectingLabel: Schema.NullOr(Schema.String),
  remotes: Schema.Array(SshRemoteEnvironmentSchema),
});
export type EnvironmentSnapshot = typeof EnvironmentSnapshotSchema.Type;

export const DiscoveredSshHostSchema = Schema.Struct({
  alias: Schema.NonEmptyString,
  hostname: Schema.NonEmptyString,
  username: Schema.NullOr(Schema.String),
  port: Schema.NullOr(Schema.Int),
  source: Schema.Literals(["ssh-config", "known-hosts"]),
});
export type DiscoveredSshHost = typeof DiscoveredSshHostSchema.Type;

export const emptyEnvironmentSnapshot = (): EnvironmentSnapshot => ({
  revision: 0,
  activeId: LOCAL_ENVIRONMENT_ID,
  connectingLabel: null,
  remotes: [],
});

export const DesktopBootstrapSchema = Schema.Struct({
  status: ServerStatusSchema,
  statusRevision: Schema.Natural,
  os: DesktopOsSchema,
  environments: EnvironmentSnapshotSchema,
});
export type DesktopBootstrap = typeof DesktopBootstrapSchema.Type;

export const StatusSubscribeInputSchema = Schema.Struct({
  after: Schema.Natural,
});

export const desktopContract = {
  bootstrap: oc.output(DesktopBootstrapSchema),
  status: {
    subscribe: oc
      .input(StatusSubscribeInputSchema)
      .output(asyncIteratorObject(toStandardSchema(ServerStatusSnapshotSchema))),
  },
  server: {
    connection: oc.output(ServerConnectionSchema),
    retry: oc.output(Schema.Void),
  },
  environments: {
    snapshot: oc.output(EnvironmentSnapshotSchema),
    subscribe: oc
      .input(StatusSubscribeInputSchema)
      .output(asyncIteratorObject(toStandardSchema(EnvironmentSnapshotSchema))),
    discoverSshHosts: oc.output(Schema.Array(DiscoveredSshHostSchema)),
    connectSsh: oc.input(Schema.Struct({ target: Schema.NonEmptyString })).output(Schema.Void),
    disconnectSsh: oc.output(Schema.Void),
    removeSsh: oc.input(Schema.Struct({ id: Schema.NonEmptyString })).output(Schema.Void),
  },
  app: {
    quit: oc.output(Schema.Void),
  },
};

export type DesktopContract = typeof desktopContract;
