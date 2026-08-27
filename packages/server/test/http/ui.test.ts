import { HttpServerResponse } from "effect/unstable/http";
import { describe, expect, it } from "vitest";

import { withStaticCacheControl } from "../../src/http/ui";

describe("withStaticCacheControl", () => {
  it("caches versioned Vite assets immutably", () => {
    const response = withStaticCacheControl(
      "/assets/index-pjSmfRhB.js",
      HttpServerResponse.text("asset"),
    );

    expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("keeps index.html and SPA fallbacks revalidating", () => {
    const index = withStaticCacheControl("/", HttpServerResponse.text("index"));
    const deepLink = withStaticCacheControl(
      "/projects/123/sessions/456",
      HttpServerResponse.text("index"),
    );

    expect(index.headers["cache-control"]).toBe("no-cache");
    expect(deepLink.headers["cache-control"]).toBe("no-cache");
  });

  it("does not make an extensionless SPA fallback under /assets immutable", () => {
    const response = withStaticCacheControl(
      "/assets/settings",
      HttpServerResponse.empty({ status: 304 }),
    );

    expect(response.headers["cache-control"]).toBe("no-cache");
  });

  it("preserves immutable caching on range and conditional responses", () => {
    const range = withStaticCacheControl(
      "/assets/index-pjSmRhB.js",
      HttpServerResponse.text("asset", { status: 206 }),
    );
    const notModified = withStaticCacheControl(
      "/assets/index-pjSmRhB.js",
      HttpServerResponse.empty({ status: 304 }),
    );

    expect(range.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(notModified.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("does not cache missing assets or server failures", () => {
    const missing = withStaticCacheControl(
      "/assets/missing-deadbeef.js",
      HttpServerResponse.text("missing", { status: 404 }),
    );
    const failure = withStaticCacheControl(
      "/assets/index-pjSmRhB.js",
      HttpServerResponse.text("failure", { status: 500 }),
    );

    expect(missing.headers["cache-control"]).toBeUndefined();
    expect(failure.headers["cache-control"]).toBeUndefined();
  });
});
