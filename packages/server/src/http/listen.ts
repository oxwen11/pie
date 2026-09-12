import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

export const DEFAULT_LISTEN_HOST = "127.0.0.1";

export function isLoopbackBind(host: string): boolean {
  const trimmed = host.trim().toLowerCase();
  return (
    trimmed === DEFAULT_LISTEN_HOST ||
    trimmed === "localhost" ||
    trimmed === "::1" ||
    trimmed === "[::1]"
  );
}

/**
 * Hostnames to add to `PIE_ALLOWED_HOSTS` when the daemon binds a specific
 * non-loopback address (LAN). `0.0.0.0` / `::` do not name a Host header.
 */
export function extraAllowedHostsForListen(host: string): readonly string[] {
  const trimmed = host.trim();
  if (
    trimmed.length === 0 ||
    trimmed === DEFAULT_LISTEN_HOST ||
    trimmed === "localhost" ||
    trimmed === "0.0.0.0" ||
    trimmed === "::" ||
    trimmed === "[::]" ||
    trimmed === "::1" ||
    trimmed === "[::1]"
  ) {
    return [];
  }
  return [trimmed];
}

export function listenServer(
  server: Server,
  port: number,
  host: string = DEFAULT_LISTEN_HOST,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- listen() on 127.0.0.1 yields AddressInfo
      resolve((server.address() as AddressInfo).port);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}
