import net from "node:net";
import type { AddressInfo } from "node:net";

import {
  pipeSockets,
  RELAY_CONTROL_PREFIX,
  RELAY_DATA_PREFIX,
  RELAY_OPEN_PREFIX,
  RELAY_READY,
  relayPublicBaseUrl,
} from "./protocol";

export type RelayListenHandle = {
  readonly port: number;
  readonly controlPort: number;
  readonly publicBaseUrl: string;
  readonly close: () => Promise<void>;
};

const FIRST_LINE_LIMIT = 1024;
const DEFAULT_WAITING_TIMEOUT_MS = 10_000;

function listenTcp(port: number, host: string): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    const onError = (error: Error) => {
      server.close();
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve(server);
    });
  });
}

function readFirstLine(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("relay connection closed before handshake"));
    };
    const onData = (data: Buffer) => {
      chunks.push(data);
      const buf = Buffer.concat(chunks);
      const idx = buf.indexOf("\n");
      if (idx === -1) {
        if (buf.length > FIRST_LINE_LIMIT) {
          cleanup();
          socket.destroy();
          reject(new Error("relay handshake too long"));
        }
        return;
      }
      cleanup();
      const line = buf.subarray(0, idx).toString("utf8").replace(/\r$/, "");
      const rest = buf.subarray(idx + 1);
      if (rest.length > 0) socket.unshift(rest);
      resolve(line);
    };
    const cleanup = () => {
      socket.pause();
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

type WaitingClient = {
  readonly socket: net.Socket;
  readonly timer: ReturnType<typeof setTimeout>;
};

export async function listenRelay(input: {
  readonly port: number;
  readonly token: string;
  readonly publicHost: string;
  readonly host?: string;
  readonly controlPort?: number;
  readonly waitingTimeoutMs?: number;
}): Promise<RelayListenHandle> {
  const bindHost = input.host ?? "0.0.0.0";
  const waitingTimeoutMs = input.waitingTimeoutMs ?? DEFAULT_WAITING_TIMEOUT_MS;
  const waiting = new Map<string, WaitingClient>();
  let control: net.Socket | undefined;
  let nextStream = 1;

  const dropClient = (streamId: string, socket: net.Socket) => {
    const pending = waiting.get(streamId);
    if (pending !== undefined && pending.socket === socket) {
      clearTimeout(pending.timer);
      waiting.delete(streamId);
    }
    socket.destroy();
  };

  const dropControl = () => {
    if (control !== undefined) {
      control.destroy();
      control = undefined;
    }
    for (const pending of waiting.values()) {
      clearTimeout(pending.timer);
      pending.socket.destroy();
    }
    waiting.clear();
  };

  const publicServer = await listenTcp(input.port, bindHost);
  let controlServer: net.Server;
  try {
    controlServer = await listenTcp(input.controlPort ?? 0, bindHost);
  } catch (error) {
    await closeServer(publicServer);
    throw error;
  }

  publicServer.on("connection", (socket) => {
    socket.pause();
    socket.setNoDelay(true);
    if (control === undefined || control.destroyed) {
      socket.destroy();
      return;
    }
    const streamId = String(nextStream);
    nextStream += 1;
    const timer = setTimeout(() => dropClient(streamId, socket), waitingTimeoutMs);
    waiting.set(streamId, { socket, timer });
    socket.on("close", () => dropClient(streamId, socket));
    socket.on("error", () => dropClient(streamId, socket));
    control.setNoDelay(true);
    control.write(`${RELAY_OPEN_PREFIX}${streamId}\n`, (error) => {
      if (error) dropClient(streamId, socket);
    });
  });

  controlServer.on("connection", (socket) => {
    void readFirstLine(socket)
      .then((line) => {
        if (line === `${RELAY_CONTROL_PREFIX}${input.token}`) {
          if (control !== undefined) {
            socket.destroy();
            return;
          }
          control = socket;
          socket.write(`${RELAY_READY}\n`);
          socket.on("close", () => {
            if (control === socket) dropControl();
          });
          socket.on("error", () => {
            if (control === socket) dropControl();
          });
          return;
        }

        if (!line.startsWith(RELAY_DATA_PREFIX)) {
          socket.destroy();
          return;
        }
        const rest = line.slice(RELAY_DATA_PREFIX.length);
        const space = rest.indexOf(" ");
        const presented = space === -1 ? rest : rest.slice(0, space);
        const streamId = space === -1 ? "" : rest.slice(space + 1);
        if (presented !== input.token) {
          socket.destroy();
          return;
        }
        const pending = waiting.get(streamId);
        if (pending === undefined) {
          socket.destroy();
          return;
        }
        waiting.delete(streamId);
        clearTimeout(pending.timer);
        socket.write(`${RELAY_READY}\n`);
        setImmediate(() => pipeSockets(pending.socket, socket));
      })
      .catch(() => {
        socket.destroy();
      });
  });

  const port = (publicServer.address() as AddressInfo).port;
  const controlPort = (controlServer.address() as AddressInfo).port;
  return {
    port,
    controlPort,
    publicBaseUrl: relayPublicBaseUrl({ host: input.publicHost, port }),
    close: async () => {
      dropControl();
      await closeServer(publicServer);
      await closeServer(controlServer);
    },
  };
}
