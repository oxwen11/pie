import { asyncIteratorObject, oc } from "@orpc/contract";
import { z } from "zod";

// Compile the final wire schemas so oRPC parse rides Zod 4.5's AOT fast path.
// Derived schemas drop the compiled function — wrap the finished object, not
// an intermediate. This module is only imported as a value from Main, where
// `new Function` is available; the renderer CSP has no `unsafe-eval`.

export const ServerStatusSchema = z.compile(
  z.enum(["starting", "ready", "reconnecting", "failed"]),
);
export type ServerStatus = z.infer<typeof ServerStatusSchema>;

export const ServerStatusSnapshotSchema = z.compile(
  z.object({
    revision: z.number().int().nonnegative(),
    status: ServerStatusSchema,
  }),
);
export type ServerStatusSnapshot = z.infer<typeof ServerStatusSnapshotSchema>;

export const ServerConnectionSchema = z.compile(
  z.object({
    httpBaseUrl: z.string(),
    wsBaseUrl: z.string(),
    token: z.string().min(1),
  }),
);
export type ServerConnection = z.infer<typeof ServerConnectionSchema>;

/** The three desktop targets, normalized off `process.platform`. */
export const DesktopOsSchema = z.compile(z.enum(["macos", "windows", "linux"]));
export type DesktopOs = z.infer<typeof DesktopOsSchema>;

export const DesktopBootstrapSchema = z.compile(
  z.object({
    status: ServerStatusSchema,
    statusRevision: z.number().int().nonnegative(),
    os: DesktopOsSchema,
  }),
);
export type DesktopBootstrap = z.infer<typeof DesktopBootstrapSchema>;

export const StatusSubscribeInputSchema = z.compile(
  z.object({ after: z.number().int().nonnegative() }),
);

export const desktopContract = {
  bootstrap: oc.output(DesktopBootstrapSchema),
  status: {
    subscribe: oc
      .input(StatusSubscribeInputSchema)
      .output(asyncIteratorObject(ServerStatusSnapshotSchema)),
  },
  server: {
    connection: oc.output(ServerConnectionSchema),
    retry: oc.output(z.void()),
  },
  app: {
    quit: oc.output(z.void()),
  },
};

export type DesktopContract = typeof desktopContract;
