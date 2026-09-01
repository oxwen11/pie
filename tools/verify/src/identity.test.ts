import { describe, expect, it } from "vitest";

import { CLI, DESKTOP, WEB, assertPiePortAllowed, identityFor } from "./identity.ts";

describe("identity roots", () => {
  it("keeps the three isolation homes apart", () => {
    expect(WEB.root).toBe(process.env.VERIFY_PIE_ROOT ?? "/tmp/pie-verify-web");
    expect(CLI.root).toBe(process.env.VERIFY_PIE_CLI_ROOT ?? "/tmp/pie-verify-cli");
    expect(DESKTOP.root).toBe(process.env.VERIFY_PIE_DESKTOP_ROOT ?? "/tmp/pie-verify-desktop");
    expect(WEB.browserSession).toBe(process.env.VERIFY_PIE_BROWSER_SESSION ?? "pie-verify-web");
    expect(DESKTOP.browserSession).toBe(
      process.env.VERIFY_PIE_DESKTOP_BROWSER_SESSION ?? "pie-verify-desktop",
    );
  });

  it("returns the matching identity", () => {
    expect(identityFor("web")).toBe(WEB);
    expect(identityFor("cli")).toBe(CLI);
    expect(identityFor("desktop")).toBe(DESKTOP);
  });

  it("pins build, taken policy, and pid files per surface", () => {
    expect(WEB.build).toBe("core");
    expect(WEB.takenPolicy).toBe("pie-and-vite");
    expect(WEB.pidFiles).toEqual(["pids/server.pid", "pids/vite.pid"]);
    expect(WEB.allowServe).toBe(false);
    expect(CLI.build).toBe("core");
    expect(CLI.takenPolicy).toBe("pie");
    expect(CLI.pidFiles).toEqual(["pids/serve.pid"]);
    expect(CLI.allowServe).toBe(true);
    expect(DESKTOP.build).toBe("server");
    expect(DESKTOP.takenPolicy).toBe("cdp");
    expect(DESKTOP.pidFiles).toEqual(["pids/electron-vite.pid"]);
    expect(DESKTOP.needsDisplay).toBe(true);
  });
});

describe("assertPiePortAllowed", () => {
  it("rejects the user/desktop daemon port on web and cli", () => {
    expect(() => assertPiePortAllowed(WEB, 4000)).toThrow(/PIE_PORT=4000/);
    expect(() => assertPiePortAllowed(CLI, 4000)).toThrow(/PIE_PORT=4000/);
  });

  it("rejects the web verify ports on cli and desktop", () => {
    expect(() => assertPiePortAllowed(CLI, 4180)).toThrow(/4180/);
    expect(() => assertPiePortAllowed(CLI, 4190)).toThrow(/4190/);
    expect(() => assertPiePortAllowed(DESKTOP, 4180)).toThrow(/4180/);
    expect(() => assertPiePortAllowed(DESKTOP, 4190)).toThrow(/4190/);
  });

  it("rejects the isolated CLI port on desktop only", () => {
    expect(() => assertPiePortAllowed(DESKTOP, 4182)).toThrow(/4182/);
    expect(() => assertPiePortAllowed(CLI, 4182)).not.toThrow();
  });

  it("allows the desktop-preferred daemon port", () => {
    expect(() => assertPiePortAllowed(DESKTOP, 4000)).not.toThrow();
  });
});
