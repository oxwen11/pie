import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

export function listenServer(server: Server, port: number): Promise<number> {
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
    server.listen(port, "127.0.0.1");
  });
}
