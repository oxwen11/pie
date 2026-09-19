import { describe, expect, it } from "vitest";

import { dispatchCommands } from "./commands.ts";
import { cliSurface } from "./surfaces/cli.ts";
import { webSurface } from "./surfaces/web.ts";

describe("dispatchCommands", () => {
  it("does not forward agent-browser", async () => {
    await expect(dispatchCommands(webSurface, ["browser", "snapshot"])).rejects.toThrow(
      /unknown command browser/,
    );
    await expect(dispatchCommands(cliSurface, ["browser", "snapshot"])).rejects.toThrow(
      /unknown command browser/,
    );
  });

  it("refuses env on the CLI surface", async () => {
    await expect(dispatchCommands(cliSurface, ["env"])).rejects.toThrow(/no browser/);
  });
});
