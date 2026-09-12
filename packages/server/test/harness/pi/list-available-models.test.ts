import assert from "node:assert/strict";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { afterEach, describe, it } from "vitest";

import {
  listAvailablePiModels,
  parsePiListModelsTable,
} from "../../../src/harness/pi/list-available-models";

const fakePi = path.join(import.meta.dirname, "../../../../../tools/testing/fake-pi.mjs");

describe("listAvailablePiModels", () => {
  const previousExecutable = process.env["PIE_PI_EXECUTABLE"];
  const previousLibrary = process.env["PIE_PI_LIBRARY"];

  afterEach(() => {
    if (previousExecutable === undefined) delete process.env["PIE_PI_EXECUTABLE"];
    else process.env["PIE_PI_EXECUTABLE"] = previousExecutable;
    if (previousLibrary === undefined) delete process.env["PIE_PI_LIBRARY"];
    else process.env["PIE_PI_LIBRARY"] = previousLibrary;
  });

  it("parses the host pi --list-models table", () => {
    const listed = parsePiListModelsTable(`provider       model         context
xai            grok-4.3      1M
cliproxyapi    gpt-5.6-sol   272K
`);
    assert.deepEqual(
      listed.models.map((model) => `${model.provider}/${model.modelId}`),
      ["xai/grok-4.3", "cliproxyapi/gpt-5.6-sol"],
    );
    assert.equal(listed.defaultModel?.provider, "xai");
    assert.equal(listed.defaultModel?.modelId, "grok-4.3");
  });

  it("lists models from the host pi CLI", async () => {
    process.env["PIE_PI_EXECUTABLE"] = fakePi;
    delete process.env["PIE_PI_LIBRARY"];
    const listed = await Effect.runPromise(
      listAvailablePiModels(process.cwd()).pipe(Effect.provide(NodeServices.layer)),
    );
    assert.deepEqual(
      listed.models.map((model) => `${model.provider}/${model.modelId}`),
      ["xai/grok-4.3", "cliproxyapi/gpt-5.6-sol"],
    );
    assert.equal(listed.defaultModel?.provider, "xai");
    assert.equal(listed.defaultModel?.modelId, "grok-4.3");
  });
});
