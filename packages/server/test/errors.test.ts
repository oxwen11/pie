import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ProjectNotFound, StoreWriteError } from "../src/errors";

describe("domain tagged errors", () => {
  it("encode and decode as Schema while keeping _tag", () => {
    const error = new ProjectNotFound({ projectId: "proj-a" });
    const encoded = Schema.encodeSync(ProjectNotFound)(error);
    const decoded = Schema.decodeUnknownSync(ProjectNotFound)(encoded);
    expect(decoded._tag).toBe("ProjectNotFound");
    expect(decoded.projectId).toBe("proj-a");
  });

  it("keeps a Defect cause through encode/decode", () => {
    const error = new StoreWriteError({ file: "sessions", cause: new Error("disk full") });
    expect(error._tag).toBe("StoreWriteError");
    const encoded = Schema.encodeSync(StoreWriteError)(error);
    const decoded = Schema.decodeUnknownSync(StoreWriteError)(encoded);
    expect(decoded._tag).toBe("StoreWriteError");
    expect(decoded.file).toBe("sessions");
  });
});
