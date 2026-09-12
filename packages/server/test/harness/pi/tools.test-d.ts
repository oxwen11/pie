import type {
  AgentToolResult,
  BashToolDetails,
  BashToolInput,
  EditToolDetails,
  EditToolInput,
  ReadToolDetails,
  ReadToolInput,
} from "@earendil-works/pi-coding-agent";
import { describe, expectTypeOf, test } from "vitest";

import type { PiTools } from "../../../src/harness/pi/tools";

type In<K extends keyof PiTools> = PiTools[K]["input"];
type Out<K extends keyof PiTools> = PiTools[K]["output"];

describe("pi tool types", () => {
  test("bash", () => {
    expectTypeOf<In<"bash">>().toEqualTypeOf<BashToolInput>();
    expectTypeOf<Out<"bash">>().toEqualTypeOf<AgentToolResult<BashToolDetails>>();
  });
  test("read", () => {
    expectTypeOf<In<"read">>().toEqualTypeOf<ReadToolInput>();
    expectTypeOf<Out<"read">["content"]>().toEqualTypeOf<[]>();
    expectTypeOf<NonNullable<Out<"read">["details"]>["truncation"]>().toEqualTypeOf<
      Omit<NonNullable<ReadToolDetails["truncation"]>, "content"> | undefined
    >();
  });
  test("edit", () => {
    expectTypeOf<In<"edit">>().toEqualTypeOf<EditToolInput>();
    expectTypeOf<Out<"edit">>().toEqualTypeOf<AgentToolResult<EditToolDetails>>();
  });
});
