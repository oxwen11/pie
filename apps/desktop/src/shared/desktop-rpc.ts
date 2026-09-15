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

export const SshRemoteEnvironmentSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  environmentId: Schema.NonEmptyString,
  label: Schema.NonEmptyString,
  alias: Schema.NonEmptyString,
  connection: ServerConnectionSchema,
});
export type SshRemoteEnvironment = typeof SshRemoteEnvironmentSchema.Type;

export const ConnectingSshHostSchema = Schema.Struct({
  target: Schema.NonEmptyString,
  blocking: Schema.Boolean,
});
export type ConnectingSshHost = typeof ConnectingSshHostSchema.Type;

export const EnvironmentSnapshotSchema = Schema.Struct({
  revision: Schema.Natural,
  connecting: Schema.Array(ConnectingSshHostSchema),
  remotes: Schema.Array(SshRemoteEnvironmentSchema),
});
export type EnvironmentSnapshot = typeof EnvironmentSnapshotSchema.Type;

export const DiscoveredSshHostSchema = Schema.Struct({
  alias: Schema.NonEmptyString,
  hostname: Schema.NonEmptyString,
  username: Schema.NullOr(Schema.String),
  port: Schema.NullOr(Schema.Int),
  source: Schema.Literals(["ssh-config", "tailscale"]),
});
export type DiscoveredSshHost = typeof DiscoveredSshHostSchema.Type;

export const SshClientAvailabilitySchema = Schema.Union([
  Schema.Struct({ available: Schema.Literal(true) }),
  Schema.Struct({ available: Schema.Literal(false), message: Schema.NonEmptyString }),
]);
export type SshClientAvailability = typeof SshClientAvailabilitySchema.Type;

export const TailscaleClientAvailabilitySchema = SshClientAvailabilitySchema;
export type TailscaleClientAvailability = typeof TailscaleClientAvailabilitySchema.Type;

export const TailscaleSnapshotSchema = Schema.Struct({
  client: TailscaleClientAvailabilitySchema,
  loggedIn: Schema.Boolean,
  magicDnsName: Schema.NullOr(Schema.String),
  httpsBaseUrl: Schema.NullOr(Schema.String),
  serveEnabled: Schema.Boolean,
});
export type TailscaleSnapshot = typeof TailscaleSnapshotSchema.Type;

export const DesktopBootstrapSchema = Schema.Struct({
  status: ServerStatusSchema,
  statusRevision: Schema.Natural,
  os: DesktopOsSchema,
  sshClient: SshClientAvailabilitySchema,
  tailscaleClient: TailscaleClientAvailabilitySchema,
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
    removeSsh: oc.input(Schema.Struct({ id: Schema.NonEmptyString })).output(Schema.Void),
  },
  tailscale: {
    snapshot: oc.output(TailscaleSnapshotSchema),
    enableServe: oc.output(Schema.Void),
    disableServe: oc.output(Schema.Void),
  },
  app: {
    quit: oc.output(Schema.Void),
  },
};

export type DesktopContract = typeof desktopContract;
