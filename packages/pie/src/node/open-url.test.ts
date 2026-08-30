import { describe, expect, it } from "vitest";

import { systemOpenCommand } from "./open-url";

const url = "http://127.0.0.1:4000/pair#grant=one-time";

describe("systemOpenCommand", () => {
  it("uses macOS open without a shell", () => {
    expect(systemOpenCommand(url, "darwin")).toEqual({ file: "open", args: [url] });
  });

  it("uses xdg-open on Linux", () => {
    expect(systemOpenCommand(url, "linux")).toEqual({ file: "xdg-open", args: [url] });
  });

  it("uses cmd start on Windows", () => {
    expect(systemOpenCommand(url, "win32")).toEqual({
      file: "cmd.exe",
      args: ["/c", "start", "", url],
    });
  });
});
