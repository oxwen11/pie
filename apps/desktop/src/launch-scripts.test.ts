import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import desktopPackage from "../package.json";

describe.each(["dev", "preview"] as const)("desktop %s", (command) => {
  it.each([0, 17])("installs Electron before launching (installer exit %i)", (exitCode) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-desktop-launch-"));
    const trace = path.join(dir, "trace");
    try {
      fs.writeFileSync(
        path.join(dir, "install-electron"),
        `#!/bin/sh\nprintf 'install\\n' >> "$TRACE"\nexit ${exitCode}\n`,
        { mode: 0o755 },
      );
      fs.writeFileSync(
        path.join(dir, "electron-vite"),
        '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TRACE"\n',
        { mode: 0o755 },
      );
      const result = childProcess.spawnSync(
        "sh",
        ["-c", `${desktopPackage.scripts[command]} --help`],
        {
          cwd: dir,
          env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, TRACE: trace },
          encoding: "utf8",
          timeout: 5000,
        },
      );
      expect(result.status).toBe(exitCode);
      expect(fs.readFileSync(trace, "utf8")).toBe(
        exitCode === 0 ? `install\n${command} --help\n` : "install\n",
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
