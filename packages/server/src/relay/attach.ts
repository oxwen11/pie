import net from "node:net";

import {
  pipeSockets,
  RELAY_CONTROL_PREFIX,
  RELAY_DATA_PREFIX,
  RELAY_OPEN_PREFIX,
  RELAY_READY,
} from "./protocol";

export type RelayAttachHandle = {
  readonly close: () => Promise<void>;
};

function connectTcp(host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port }, () => {
      socket.setNoDelay(true);
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

const READY_TIMEOUT_MS = 8_000;

function waitForReady(socket: net.Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("relay closed the connection"));
    };
    const onData = (data: Buffer) => {
      chunks.push(data);
      const buf = Buffer.concat(chunks);
      const idx = buf.indexOf("\n");
      if (idx === -1) return;
      cleanup();
      const line = buf.subarray(0, idx).toString("utf8").replace(/\r$/, "");
      const rest = buf.subarray(idx + 1);
      if (line !== RELAY_READY) {
        reject(new Error("relay did not accept the connection"));
        return;
      }
      resolve(rest);
    };
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("relay handshake timed out"));
    }, READY_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
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

function onControlLines(
  socket: net.Socket,
  onLine: (line: string) => void,
  initial: Buffer = Buffer.alloc(0),
): void {
  let pending = initial.length > 0 ? initial.toString("utf8") : "";
  const consume = () => {
    for (;;) {
      const idx = pending.indexOf("\n");
      if (idx === -1) break;
      const line = pending.slice(0, idx).replace(/\r$/, "");
      pending = pending.slice(idx + 1);
      if (line.length > 0) onLine(line);
    }
  };
  consume();
  socket.on("data", (chunk: Buffer) => {
    pending += chunk.toString("utf8");
    consume();
  });
  socket.resume();
}

export async function attachRelay(input: {
  readonly relayHost: string;
  readonly relayPort: number;
  readonly token: string;
  readonly localHost: string;
  readonly localPort: number;
}): Promise<RelayAttachHandle> {
  const control = await connectTcp(input.relayHost, input.relayPort);
  const controlReady = waitForReady(control);
  control.write(`${RELAY_CONTROL_PREFIX}${input.token}\n`);
  const controlLeftover = await controlReady;

  const dataSockets = new Set<net.Socket>();

  const openStream = async (streamId: string) => {
    const data = await connectTcp(input.relayHost, input.relayPort);
    dataSockets.add(data);
    const dataReady = waitForReady(data);
    data.write(`${RELAY_DATA_PREFIX}${input.token} ${streamId}\n`);
    const leftover = await dataReady;
    const local = await connectTcp(input.localHost, input.localPort);
    dataSockets.add(local);
    if (leftover.length > 0) local.write(leftover);
    const drop = () => {
      dataSockets.delete(data);
      dataSockets.delete(local);
      data.destroy();
      local.destroy();
    };
    data.on("close", drop);
    local.on("close", drop);
    pipeSockets(data, local);
  };

  control.setNoDelay(true);
  control.setKeepAlive(true);
  onControlLines(
    control,
    (line) => {
      if (!line.startsWith(RELAY_OPEN_PREFIX)) return;
      const streamId = line.slice(RELAY_OPEN_PREFIX.length).trim();
      if (streamId.length === 0) return;
      void openStream(streamId).catch((error: unknown) => {
        console.error("relay openStream failed", streamId, error);
      });
    },
    controlLeftover,
  );

  const close = async () => {
    for (const socket of dataSockets) socket.destroy();
    dataSockets.clear();
    control.destroy();
  };

  control.on("close", () => {
    void close();
  });

  return { close };
}
