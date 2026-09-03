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

export const DesktopBootstrapSchema = Schema.Struct({
  status: ServerStatusSchema,
  statusRevision: Schema.Natural,
  os: DesktopOsSchema,
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
  app: {
    quit: oc.output(Schema.Void),
  },
};

export type DesktopContract = typeof desktopContract;
