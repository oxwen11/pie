import { afterEach, describe, expect, it } from "vitest";

import { CLI, DESKTOP, WEB } from "../identity.ts";
import { portPlan } from "./ports.ts";

const savedPie = process.env.PIE_PORT;
const savedCdp = process.env.PIE_REMOTE_DEBUG_PORT;

afterEach(() => {
  if (savedPie === undefined) {
    delete process.env.PIE_PORT;
  } else {
    process.env.PIE_PORT = savedPie;
  }
  if (savedCdp === undefined) {
    delete process.env.PIE_REMOTE_DEBUG_PORT;
  } else {
    process.env.PIE_REMOTE_DEBUG_PORT = savedCdp;
  }
});

describe("portPlan", () => {
  it("refuses the pie and vite ports on web", () => {
    delete process.env.PIE_PORT;
    expect(portPlan(WEB)).toEqual({
      piePort: 4180,
      vitePort: 4190,
      cdpPort: undefined,
      refuseTaken: [4180, 4190],
      warnTaken: [],
    });
  });

  it("refuses only the pie port on cli", () => {
    delete process.env.PIE_PORT;
    expect(portPlan(CLI)).toEqual({
      piePort: 4182,
      vitePort: undefined,
      cdpPort: undefined,
      refuseTaken: [4182],
      warnTaken: [],
    });
  });

  it("refuses CDP and warns on the preferred desktop daemon port", () => {
    delete process.env.PIE_PORT;
    delete process.env.PIE_REMOTE_DEBUG_PORT;
    expect(portPlan(DESKTOP)).toEqual({
      piePort: 4000,
      vitePort: undefined,
      cdpPort: 9223,
      refuseTaken: [9223],
      warnTaken: [4000],
    });
  });
});
