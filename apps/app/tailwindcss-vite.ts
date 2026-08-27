import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";

function hotUpdateFn(hook: Plugin["hotUpdate"]) {
  if (hook == null) return undefined;
  return typeof hook === "function" ? hook : hook.handler;
}

/**
 * Vite 8 `experimental.bundledDev` dispatches HMR through Rolldown, which
 * calls `hotUpdate` with `{ type, file, modules }` only — no `server`.
 * `@tailwindcss/vite` 4.3.3 then reads `server.environments` and the serve
 * plugin throws, which Rolldown reports as a build error.
 *
 * Skip Tailwind's scanned-file full-reload path when `server` is missing;
 * modules already in the graph still HMR through Rolldown's default path.
 */
export function tailwindcssVite(): Plugin[] {
  const plugins = tailwindcss();
  for (const plugin of plugins) {
    const hotUpdate = hotUpdateFn(plugin.hotUpdate);
    if (hotUpdate == null) continue;
    plugin.hotUpdate = function (this, options) {
      if (options.server?.environments == null) return;
      return hotUpdate.call(this, options);
    };
  }
  return plugins;
}
