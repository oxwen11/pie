import url from "node:url";

export const src = url.fileURLToPath(new URL("./src", import.meta.url));
export const appDir = import.meta.dirname;

export const browserTsTests = [
  "src/theme.test.ts",
  "src/features/chat/components/transcript/tool-batch.test.ts",
  "src/features/projects/use-project-sessions.test.ts",
  "src/features/chat/components/input/use-chat-input-has-content.test.ts",
  "src/features/chat/components/input/chat-input-controller.test.ts",
];

export const appAlias = {
  root: appDir,
  resolve: {
    alias: { "@": src, clsx: "cn", "tailwind-merge": "cn" },
    tsconfigPaths: true,
  },
};
