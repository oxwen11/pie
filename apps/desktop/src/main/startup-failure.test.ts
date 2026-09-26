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
});
