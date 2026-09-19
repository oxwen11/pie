import { describe, expect, it } from "vitest";

import {
  MODELS_DEV_LOGO_CACHE_CONTROL,
  rewriteModelsDevLogoCacheHeaders,
} from "./models-dev-logo-cache";

describe("rewriteModelsDevLogoCacheHeaders", () => {
  it("replaces models.dev's max-age=0 with a long-lived cache-control", () => {
    expect(
      rewriteModelsDevLogoCacheHeaders({
        "Cache-Control": ["public, max-age=0, must-revalidate"],
        ETag: ['"abc"'],
        "Content-Type": ["image/svg+xml"],
      }),
    ).toEqual({
      ETag: ['"abc"'],
      "Content-Type": ["image/svg+xml"],
      "cache-control": [MODELS_DEV_LOGO_CACHE_CONTROL],
    });
  });

  it("still sets cache-control when the response has no headers", () => {
    expect(rewriteModelsDevLogoCacheHeaders(undefined)).toEqual({
      "cache-control": [MODELS_DEV_LOGO_CACHE_CONTROL],
    });
  });
});
