import { describe, expect, it } from "vitest";

import { dispatchCommands } from "./commands.ts";
import { cliSurface } from "./surfaces/cli.ts";

describe("dispatchCommands", () => {
  it("refuses agent-browser on the CLI surface", async () => {
    await expect(dispatchCommands(cliSurface, ["browser", "snapshot"])).rejects.toThrow(
      /no browser/,
    );
  });

  it("refuses env on the CLI surface", async () => {
    await expect(dispatchCommands(cliSurface, ["env"])).rejects.toThrow(/no browser/);
  });
});
