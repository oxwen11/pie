import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { makeRpcTestHarness, writeFakePiExecutable } from "./rpc-harness";

describe("schedule router", () => {
  it("creates, lists, updates, runs, and deletes an application schedule", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pie-project-"));
    const h = await makeRpcTestHarness(home, { executable: writeFakePiExecutable() });
    try {
      const project = await h.client.project.create({ path: workspace });
      const created = await h.client.schedule.create({
        name: "Daily review",
        projectId: project.id,
        prompt: "Summarize what changed yesterday.",
        spec: { kind: "cron", expr: "0 9 * * *" },
        maxRuns: 2,
      });
      expect(created.name).toBe("Daily review");
      expect(created.enabled).toBe(true);
      expect(created.maxRuns).toBe(2);
      expect(created.nextRunAt).toBeTruthy();
      expect(created.runs).toEqual([]);

      await expect(h.client.schedule.list()).resolves.toEqual([created]);
      await expect(h.client.schedule.get({ id: created.id })).resolves.toEqual(created);

      const paused = await h.client.schedule.update({ id: created.id, enabled: false });
      expect(paused.enabled).toBe(false);

      const fired = await h.client.schedule.runNow({ id: created.id });
      expect(fired.ref?.projectId).toBe(project.id);
      expect(["running", "succeeded"]).toContain(fired.schedule.lastRunStatus);
      expect(fired.schedule.runs[0]?.reason).toBe("manual");
      expect(fired.schedule.runs[0]?.snapshot?.prompt).toBe("Summarize what changed yesterday.");

      const sessions = await h.client.agent.session.list({
        projectId: project.id,
        archived: false,
      });
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).not.toHaveProperty("schedule");
      expect(sessions[0]).not.toHaveProperty("scheduleId");
      expect(sessions[0]).not.toHaveProperty("automation");
      expect(sessions[0]).not.toHaveProperty("automationId");
      expect(sessions[0]?.title).toBe("Daily review");
      expect(fired.schedule.lastSessionId).toBe(sessions[0]?.sessionId);
      expect(fired.schedule.runs[0]?.sessionId).toBe(sessions[0]?.sessionId);
      const sessionFile = path.join(
        home,
        "storage",
        "sessions",
        project.id,
        `${sessions[0]?.sessionId}.json`,
      );
      const stored = JSON.parse(fs.readFileSync(sessionFile, "utf8")) as {
        readonly data: Record<string, unknown>;
      };
      expect(stored.data).not.toHaveProperty("schedule");
      expect(stored.data).not.toHaveProperty("scheduleId");
      expect(stored.data).not.toHaveProperty("automation");
      expect(stored.data).not.toHaveProperty("automationId");

      await h.client.schedule.delete({ id: created.id });
      await expect(h.client.schedule.list()).resolves.toEqual([]);
      if (fired.ref !== undefined) {
        await h.client.agent.session.close({ ref: fired.ref });
      }
    } finally {
      await h.dispose();
    }
  });

  it("creates with runNow and opens a session", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pie-project-"));
    const h = await makeRpcTestHarness(home, { executable: writeFakePiExecutable() });
    try {
      const project = await h.client.project.create({ path: workspace });
      const created = await h.client.schedule.create({
        name: "Immediate",
        projectId: project.id,
        prompt: "Say hello.",
        spec: { kind: "manual" },
        maxRuns: 1,
        runNow: true,
      });
      expect(created.lastSessionId).toBeTruthy();
      expect(created.firedCount).toBe(1);
      expect(created.pauseReason).toBe("max_runs");
      expect(created.enabled).toBe(false);
      const sessions = await h.client.agent.session.list({
        projectId: project.id,
        archived: false,
      });
      expect(sessions).toHaveLength(1);
      expect(created.lastSessionId).toBe(sessions[0]?.sessionId);
      if (created.lastSessionId !== undefined) {
        await h.client.agent.session.close({
          ref: { projectId: project.id, sessionId: created.lastSessionId },
        });
      }
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
