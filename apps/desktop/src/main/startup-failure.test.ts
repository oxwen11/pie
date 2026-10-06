import { describe, expect, it } from "vitest";

import { ProtocolRegistrationError } from "./electron/app-protocol";
import { SshPersistError } from "./ssh/desktop-ssh";
import { formatStartupFailure } from "./startup-failure";

describe("formatStartupFailure", () => {
  it("describes a protocol registration failure", () => {
    const message = formatStartupFailure(
      new ProtocolRegistrationError({ message: "Unable to register the pie protocol" }),
    );
    expect(message).toContain("internal protocol");
  });

  it("describes an unreadable SSH hosts file", () => {
    const message = formatStartupFailure(
      new SshPersistError({ message: "Failed to persist SSH environments to /tmp/ssh.json." }),
    );
    expect(message).toContain("saved SSH hosts");
  });
});
