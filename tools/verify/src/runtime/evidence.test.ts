import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { packEvidenceVideo } from "./evidence.ts";

describe("packEvidenceVideo", () => {
  it("packs one completed recording without replacing raw or prior output on failure", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-pack-video-"));
    const bin = path.join(dir, "bin");
    const evidence = path.join(dir, "evidence");
    const input = path.join(evidence, "recording-002.webm");
    const trace = path.join(dir, "ffmpeg-args");
    fs.mkdirSync(bin);
    fs.mkdirSync(evidence);
    fs.writeFileSync(input, "raw");
    fs.writeFileSync(
      path.join(bin, "ffmpeg"),
      `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(trace)}\nfor output do :; done\nprintf packed > "$output"\n`,
      { mode: 0o755 },
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath ?? ""}`;
    try {
      const output = packEvidenceVideo(input, evidence, "feature");
      const args = fs.readFileSync(trace, "utf8").trim().split("\n");
      expect(args.slice(4, 8)).toEqual([
        "-i",
        input,
        "-vf",
        "mpdecimate=max=7,setpts=N/FRAME_RATE/TB",
      ]);
      expect(fs.readFileSync(output, "utf8")).toBe("packed");
      expect(fs.readFileSync(input, "utf8")).toBe("raw");

      fs.writeFileSync(path.join(bin, "ffmpeg"), "#!/bin/sh\nexit 17\n", { mode: 0o755 });
      expect(() => packEvidenceVideo(input, evidence, "feature")).toThrow(/ffmpeg exited 17/);
      expect(fs.readFileSync(output, "utf8")).toBe("packed");
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects missing input, paths, and raw recording names", () => {
    expect(() => packEvidenceVideo("/tmp/missing.webm", "/tmp", "feature")).toThrow(
      /no completed recording/,
    );
    expect(() => packEvidenceVideo("/tmp/missing.webm", "/tmp", "../feature")).toThrow(
      /invalid packed video name/,
    );
    expect(() => packEvidenceVideo("/tmp/missing.webm", "/tmp", "recording-001")).toThrow(
      /invalid packed video name/,
    );
  });
});
