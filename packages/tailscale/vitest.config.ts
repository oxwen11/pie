import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "tailscale",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
