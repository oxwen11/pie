import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { makeRpcTestHarness } from "./rpc-harness";

describe("schedule router", () => {
  it("creates, lists, updates, runs, and deletes an application schedule", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pie-project-"));
    const h = await makeRpcTestHarness(home);
    try {
      const project = await h.client.project.create({ path: workspace });
      const created = await h.client.schedule.create({
        name: "Daily review",
        projectId: project.id,
        prompt: "Summarize what changed yesterday.",
        spec: { kind: "cron", expr: "0 9 * * *" },
      });
      expect(created.name).toBe("Daily review");
      expect(created.enabled).toBe(true);
      expect(created.nextRunAt).toBeTruthy();
      expect(created.runs).toEqual([]);

      await expect(h.client.schedule.list()).resolves.toEqual([created]);
      await expect(h.client.schedule.get({ id: created.id })).resolves.toEqual(created);

      const paused = await h.client.schedule.update({ id: created.id, enabled: false });
      expect(paused.enabled).toBe(false);

      const fired = await h.client.schedule.runNow({ id: created.id });
      expect(fired.ref?.projectId).toBe(project.id);
      expect(fired.schedule.lastRunStatus).toBe("started");
      expect(fired.schedule.runs[0]?.reason).toBe("manual");

      const sessions = await h.client.agent.session.list({
        projectId: project.id,
        archived: false,
      });
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.scheduleId).toBe(created.id);
      expect(sessions[0]?.title).toBe("Daily review");

      await h.client.schedule.delete({ id: created.id });
      await expect(h.client.schedule.list()).resolves.toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  it("rejects create when the project is missing", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
    const h = await makeRpcTestHarness(home);
    try {
      await expect(
        h.client.schedule.create({
          name: "Orphan",
          projectId: "00000000-0000-0000-0000-000000000000",
          prompt: "noop",
          spec: { kind: "manual" },
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await h.dispose();
    }
  });
});
