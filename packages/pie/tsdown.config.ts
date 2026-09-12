import { resolveDaemonCompatibilityKey } from "@getpie/core/compatibility";
import { defineConfig } from "tsdown";

const shared = {
  platform: "node" as const,
  format: ["esm" as const],
  minify: true,
  deps: {
    // Bundle what npm must not reinstall (Effect dual-runtime under npx).
    // Pi is a host install (`pi` on PATH), not a published or bundled dep.
    alwaysBundle: [/.*/],
    neverBundle: ["@earendil-works/pi-coding-agent", "vite"],
    onlyBundle: false,
  },
  dts: false,
  shims: true,
  env: {
    NODE_ENV: "production",
    PIE_DAEMON_COMPATIBILITY_KEY: resolveDaemonCompatibilityKey(),
  },
};

export default defineConfig([
  {
    ...shared,
    entry: ["src/node/cli.ts"],
    clean: true,
    // `@getpie/cli#build` waits for `@getpie/app#build`; ship that complete
    // artifact beside the final CLI so runtime lookup never depends on a repo.
    copy: {
      from: "../../apps/app/dist",
      to: "dist",
      rename: "client",
    },
  },
  {
    ...shared,
    // Own build so the hop is one file, not a chunk shared with `pie`.
    entry: ["src/node/relay.ts"],
    clean: false,
  },
]);
