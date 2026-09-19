import { session, type OnHeadersReceivedListenerDetails } from "electron";

/** One month — logos are brand marks, not content that must stay live. */
export const MODELS_DEV_LOGO_CACHE_CONTROL = "public, max-age=2592000, immutable";

const LOGO_URLS = ["https://models.dev/logos/*"];

/** models.dev serves max-age=0; rewrite so Chromium's disk HTTP cache keeps the SVGs. */
export function rewriteModelsDevLogoCacheHeaders(
  responseHeaders: OnHeadersReceivedListenerDetails["responseHeaders"],
) {
  return {
    ...Object.fromEntries(
      Object.entries(responseHeaders ?? {}).filter(
        ([key]) => key.toLowerCase() !== "cache-control",
      ),
    ),
    "cache-control": [MODELS_DEV_LOGO_CACHE_CONTROL],
  };
}

/** Call once after app ready. Relies on Chromium HTTP disk cache — no app memory. */
export function registerModelsDevLogoHttpCache(): void {
  session.defaultSession.webRequest.onHeadersReceived({ urls: LOGO_URLS }, (details, callback) => {
    callback({
      responseHeaders: rewriteModelsDevLogoCacheHeaders(details.responseHeaders),
    });
  });
}
