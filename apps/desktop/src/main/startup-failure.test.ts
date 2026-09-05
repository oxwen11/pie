import { Config, ConfigProvider, Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import { ProtocolRegistrationError } from "./electron/app-protocol";
import { formatStartupFailure } from "./startup-failure";

describe("formatStartupFailure", () => {
  it("describes a protocol registration failure", () => {
    const message = formatStartupFailure(
      new ProtocolRegistrationError({ message: "Unable to register the pie protocol" }),
    );
    expect(message).toContain("internal protocol");
  });

  it("describes a config failure", () => {
    const result = Effect.runSync(
      Effect.result(
        Config.int("PIE_PORT").pipe(
          Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ PIE_PORT: "nope" }))),
        ),
      ),
    );
    if (!Result.isFailure(result)) {
      throw new Error("expected config load to fail");
    }
    expect(formatStartupFailure(result.failure)).toContain("configuration");
  });
});
