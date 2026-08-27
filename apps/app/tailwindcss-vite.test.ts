import tailwindcss from "@tailwindcss/vite";
import type { HotUpdateOptions, Plugin } from "vite";
import { describe, expect, it } from "vitest";

import { tailwindcssVite } from "./tailwindcss-vite";

const bundledDevUpdate = {
  file: "/tmp/x.css",
  modules: [{ type: "asset" as const, id: undefined }],
  timestamp: 0,
};

const pluginContext = {
  environment: { name: "client", moduleGraph: { invalidateModule() {} } },
};

type HotUpdateFn = (
  this: unknown,
  options: HotUpdateOptions,
) => ReturnType<
  NonNullable<Plugin["hotUpdate"]> extends { handler: infer Handler }
    ? Handler
    : NonNullable<Plugin["hotUpdate"]>
>;

function hotUpdateHandler(plugin: Plugin): HotUpdateFn {
  const hook = plugin.hotUpdate;
  if (hook == null) {
    throw new Error("missing hotUpdate");
  }
  return (typeof hook === "function" ? hook : hook.handler) as HotUpdateFn;
}

function generateServe(plugins: Plugin[]): Plugin {
  const serve = plugins.find((plugin) => plugin.name === "@tailwindcss/vite:generate:serve");
  if (serve == null) {
    throw new Error("missing @tailwindcss/vite:generate:serve");
  }
  return serve;
}

describe("tailwindcssVite", () => {
  it("skips generate:serve hotUpdate when Rolldown omits server", () => {
    expect(
      hotUpdateHandler(generateServe(tailwindcssVite())).call(pluginContext, bundledDevUpdate),
    ).toBeUndefined();
  });

  it("forwards to Tailwind when server.environments is present", () => {
    expect(
      hotUpdateHandler(generateServe(tailwindcssVite())).call(pluginContext, {
        ...bundledDevUpdate,
        server: { environments: {} },
      }),
    ).toBeUndefined();
  });

  it("still throws without the wrapper — upstream still needs server.environments", () => {
    expect(() =>
      hotUpdateHandler(generateServe(tailwindcss())).call(pluginContext, bundledDevUpdate),
    ).toThrow(/environments/);
  });
});
