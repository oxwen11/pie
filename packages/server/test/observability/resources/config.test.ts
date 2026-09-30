import { describe, expect, it } from "vitest";

import { resolveResourceLoggingSetting } from "../../../src/observability/resources/config";

describe("resolveResourceLoggingSetting", () => {
  it("disables resource logging for 0 and invalid values", () => {
    expect(resolveResourceLoggingSetting({ PIE_RESOURCE_LOGGING: "0" })).toEqual({
      enabled: false,
      invalid: false,
    });
    expect(resolveResourceLoggingSetting({ PIE_RESOURCE_LOGGING: "yes" })).toEqual({
      enabled: false,
      invalid: true,
    });
  });
});
