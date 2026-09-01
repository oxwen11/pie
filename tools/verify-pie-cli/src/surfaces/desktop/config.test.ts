import { describe, expect, it } from "vitest";

import { refuseWebOrCliPort } from "./config.ts";

describe("refuseWebOrCliPort", () => {
  it("rejects the web verify ports", () => {
    expect(() => refuseWebOrCliPort(4180)).toThrow(/4180/);
    expect(() => refuseWebOrCliPort(4190)).toThrow(/4190/);
  });

  it("rejects the isolated CLI verify port", () => {
    expect(() => refuseWebOrCliPort(4182)).toThrow(/4182/);
  });

  it("allows the desktop-preferred daemon port", () => {
    expect(() => refuseWebOrCliPort(4000)).not.toThrow();
  });
});
