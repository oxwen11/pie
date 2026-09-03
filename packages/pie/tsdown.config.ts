import { resolveDaemonCompatibilityKey } from "@getpie/core/compatibility";
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/node/cli.ts"],
  platform: "node",
  format: ["esm"],
  minify: true,
  // `@getpie/cli#build` waits for `@getpie/app#build`; ship that complete
  // artifact beside the final CLI so runtime lookup never depends on a repo.
  copy: {
    from: "../../apps/app/dist",
    to: "dist",
    rename: "client",
  },
  deps: {
    // Bundle what npm must not reinstall (Effect dual-runtime under npx).
    // Pi is a host install (`pi` on PATH), not a published or bundled dep.
    alwaysBundle: [/.*/],
    neverBundle: ["@earendil-works/pi-coding-agent", "vite"],
    onlyBundle: false,
  },
  dts: false,
  clean: true,
  shims: true,
  env: {
    NODE_ENV: "production",
    PIE_DAEMON_COMPATIBILITY_KEY: resolveDaemonCompatibilityKey(),
  },
});
