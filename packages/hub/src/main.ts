import fs from "node:fs";
import path from "node:path";

import { DEFAULT_MAX_EVENT_BYTES, startHub } from "./server";
import { HubStore } from "./store";

const hubToken = process.env.HUB_TOKEN ?? "";
if (hubToken.length < 32) {
  throw new Error("HUB_TOKEN is required and must be at least 32 characters");
}

const home = path.resolve(process.env.HUB_HOME ?? "./hub-data");
fs.mkdirSync(home, { recursive: true, mode: 0o700 });
const file = path.join(home, "hub.sqlite");
// Create the file 0600 before SQLite does (it opens existing files as they are).
fs.closeSync(fs.openSync(file, "a", 0o600));
const store = HubStore.open(file);

const hub = await startHub(
  {
    store,
    hubToken,
    maxEventBytes: Number(process.env.HUB_MAX_EVENT_BYTES ?? DEFAULT_MAX_EVENT_BYTES),
  },
  { port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? "0.0.0.0" },
);
console.log(`hub listening on ${hub.port}`);

const stop = () => {
  // Nothing else keeps the loop alive once the server and store are closed.
  void hub.close().then(() => store.close());
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
