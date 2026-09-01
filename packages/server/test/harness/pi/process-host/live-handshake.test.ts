import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer } from "@effect/vitest";
import { Effect } from "effect";

import { makePiProcess } from "../../../../src/harness/pi/process";

layer(NodeServices.layer, { excludeTestServices: true })("pie Pi process handshake", (it) => {
  it.effect(
    "create completes get_state against the pie-owned process",
    () =>
      Effect.gen(function* () {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pie-pi-live-"));
        const agent = yield* makePiProcess();
        const { sessionId } = yield* agent.session.create({ cwd });
        assert.ok(sessionId.length > 0);
        yield* agent.session.abort(sessionId);
      }),
    45_000,
  );
});
