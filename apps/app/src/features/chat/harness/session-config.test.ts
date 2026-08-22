import type { HarnessAgentId, HarnessAgentInfo, ModelInfo, ProviderInfo } from "@pie/contract";
import { describe, expect, it } from "vitest";

import { orderPermissionModes } from "./permission-modes";
import {
  findModelInfo,
  pickDefaultHarnessAgentId,
  resolveReasoningEffort,
  resolveModel,
  resolvePermissionMode,
} from "./session-config";

const piHarness: HarnessAgentInfo = {
  id: "pi",
  name: "Pi",
  available: true,
  permissionModes: [],
};

const probeProviders: ReadonlyArray<ProviderInfo> = [
  {
    id: "pi",
    models: [
      { id: "default", label: "Default (recommended)" },
      { id: "sonnet", label: "Sonnet" },
    ],
  },
];

describe("resolveModel", () => {
  it("keeps a pick the catalog offers", () => {
    expect(resolveModel(probeProviders, "pi", "sonnet")).toEqual({
      providerId: "pi",
      modelId: "sonnet",
    });
  });

  it("resolves to nothing when the user picked nothing", () => {
    expect(resolveModel(probeProviders, undefined, undefined)).toBeUndefined();
  });

  it("drops a pick the probe doesn't vouch for", () => {
    expect(resolveModel(probeProviders, "pi", "gpt-5.6-sol")).toBeUndefined();
  });

  it("treats the modelId as provider-scoped, not global", () => {
    expect(resolveModel(probeProviders, "other", "sonnet")).toBeUndefined();
  });

  it("ignores a URL-supplied pick until the probe can vouch for it", () => {
    expect(resolveModel([], "pi", "sonnet")).toBeUndefined();
  });
});

describe("reasoningEffort cascades from the selected model", () => {
  const sol: ModelInfo = {
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    reasoningEfforts: ["low", "medium", "high"],
    defaultReasoningEffort: "medium",
  };
  const mini: ModelInfo = { id: "gpt-5.6-mini", label: "GPT-5.6 Mini" };
  const providers: ReadonlyArray<ProviderInfo> = [{ id: "pi", models: [sol, mini] }];

  it("reads the candidates off the resolved model", () => {
    const model = resolveModel(providers, "pi", "gpt-5.6-sol");
    const modelInfo = findModelInfo(providers, model?.providerId, model?.modelId);

    expect(modelInfo?.reasoningEfforts).toEqual(["low", "medium", "high"]);
    expect(resolveReasoningEffort(modelInfo, undefined)).toBe("medium");
  });

  it("keeps an explicit reasoningEffort that the model supports", () => {
    expect(resolveReasoningEffort(sol, "high")).toBe("high");
  });

  it("drops the reasoningEffort when the selected model has no reasoningEffort switch", () => {
    const modelInfo = findModelInfo(providers, "pi", "gpt-5.6-mini");

    expect(modelInfo?.reasoningEfforts).toBeUndefined();
    expect(resolveReasoningEffort(modelInfo, "high")).toBeUndefined();
  });

  it("falls back to the model default when the pick is outside its reasoningEfforts", () => {
    expect(resolveReasoningEffort(sol, "max")).toBe("medium");
  });

  it("resolves to nothing while the probe is still in flight", () => {
    expect(resolveReasoningEffort(undefined, "high")).toBeUndefined();
  });
});

describe("findModelInfo", () => {
  it("requires both halves of the pair to match", () => {
    expect(findModelInfo(probeProviders, "pi", "sonnet")?.id).toBe("sonnet");
    expect(findModelInfo(probeProviders, "other", "sonnet")).toBeUndefined();
    expect(findModelInfo(probeProviders, "pi", undefined)).toBeUndefined();
    expect(findModelInfo(probeProviders, undefined, "sonnet")).toBeUndefined();
  });
});

describe("resolvePermissionMode", () => {
  it("resolves to nothing for pi, which declares no permission protocol", () => {
    expect(resolvePermissionMode(piHarness, undefined)).toBeUndefined();
    expect(resolvePermissionMode(piHarness, "full")).toBeUndefined();
  });

  it("resolves to nothing while the list has not landed", () => {
    expect(resolvePermissionMode(undefined, "full")).toBeUndefined();
  });

  it("orders permission modes canonically for display", () => {
    expect(orderPermissionModes(["full", "plan"])).toEqual(["plan", "full"]);
  });
});

const harness = (id: HarnessAgentId, available: boolean): HarnessAgentInfo => ({
  id,
  name: id,
  available,
  permissionModes: [],
});

it("starts a draft on pi when it is installed", () => {
  expect(pickDefaultHarnessAgentId([harness("pi", true)], "pi")).toBe("pi");
});

it("keeps pi as the preferred harness when it is missing from the list", () => {
  expect(pickDefaultHarnessAgentId([], "pi")).toBe("pi");
});

it("keeps pi when nothing is installed", () => {
  expect(pickDefaultHarnessAgentId([harness("pi", false)], "pi")).toBe("pi");
});
