import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { LoopError } from "./cron";
import { LOOP_CUSTOM_TYPE } from "./prompt";
import { SessionLoopScheduler, type SchedulerHost } from "./scheduler";

const CronCreateParams = Type.Object(
  {
    prompt: Type.String({ description: "Prompt to run on the schedule" }),
    cron: Type.Optional(
      Type.String({ description: "5-field cron; exactly one of cron or run_at" }),
    ),
    run_at: Type.Optional(Type.String({ description: "Timezone-aware ISO-8601 one-shot time" })),
    recurring: Type.Optional(
      Type.Boolean({ description: "If false with cron, run only the next match" }),
    ),
  },
  { additionalProperties: false },
);

const CronDeleteParams = Type.Object(
  { task_id: Type.String({ description: "Task id from cron_list or cron_create" }) },
  { additionalProperties: false },
);

const CronListParams = Type.Object({}, { additionalProperties: false });

const ScheduleWakeupParams = Type.Object(
  {
    delay_seconds: Type.Optional(
      Type.Number({ description: "Seconds until next iteration, 60-3600" }),
    ),
    stop: Type.Optional(Type.Boolean({ description: "End the dynamic loop" })),
    reason: Type.Optional(
      Type.String({ description: "Short reason for the user, not used for scheduling" }),
    ),
  },
  { additionalProperties: false },
);

export default function piLoopExtension(pi: ExtensionAPI): void {
  let ctxRef: ExtensionContext | null = null;
  const host: SchedulerHost = {
    clock: { now: () => Date.now() },
    dispatch: {
      isIdle: () => {
        if (!ctxRef) return false;
        return ctxRef.isIdle();
      },
      hasPendingMessages: () => {
        if (!ctxRef) return true;
        return ctxRef.hasPendingMessages();
      },
      sendScheduled: (payload) => {
        pi.sendMessage(
          {
            customType: LOOP_CUSTOM_TYPE,
            content: payload.content,
            display: true,
            details: payload.details,
          },
          { triggerTurn: true },
        );
      },
    },
    getCwd: () => ctxRef?.cwd ?? process.cwd(),
    isProjectTrusted: () => ctxRef?.isProjectTrusted() ?? false,
  };
  const scheduler = new SessionLoopScheduler(host);

  pi.on("session_start", (_event, ctx) => {
    ctxRef = ctx;
    scheduler.startSession();
  });
  pi.on("agent_start", () => {
    scheduler.markStarted();
  });
  pi.on("agent_settled", (_event, ctx) => {
    ctxRef = ctx;
    scheduler.handleSettled();
  });
  pi.on("session_shutdown", () => {
    scheduler.dispose();
    ctxRef = null;
  });

  pi.registerCommand("loop", {
    description: "Create a session-scoped scheduled loop. Usage: /loop [interval] [prompt]",
    handler: async (args, ctx) => {
      ctxRef = ctx;
      const result = scheduler.createFromCommand(args);
      ctx.ui.notify(formatCreate(result), "info");
    },
  });

  pi.registerTool({
    name: "cron_create",
    label: "Cron create",
    description:
      "Create a fixed recurring or one-shot scheduled prompt in the current Session. Provide exactly one of cron (5-field) or run_at (timezone-aware ISO-8601). Do not use this to create a self-paced loop; use /loop <prompt> instead.",
    parameters: CronCreateParams,
    async execute(_id, params) {
      const hasCron = typeof params.cron === "string" && params.cron.length > 0;
      const hasRunAt = typeof params.run_at === "string" && params.run_at.length > 0;
      if (hasCron === hasRunAt) {
        throw new LoopError("INVALID_CRON", "provide exactly one of cron or run_at");
      }
      if (hasRunAt && params.recurring === true) {
        throw new LoopError("INVALID_RUN_AT", "run_at cannot be recurring");
      }
      const result = hasCron
        ? scheduler.createRecurring(params.prompt, params.cron!, params.recurring !== false)
        : scheduler.createOneShot(params.prompt, params.run_at!);
      return textResult(JSON.stringify(result));
    },
  });

  pi.registerTool({
    name: "cron_list",
    label: "Cron list",
    description: "List active scheduled tasks in the current Session only.",
    parameters: CronListParams,
    async execute() {
      return textResult(JSON.stringify(scheduler.list()));
    },
  });

  pi.registerTool({
    name: "cron_delete",
    label: "Cron delete",
    description:
      "Delete the future schedule and local pending fire for a task in the current Session. Does not abort work already sent to the model.",
    parameters: CronDeleteParams,
    async execute(_id, params) {
      const outcome = scheduler.delete(params.task_id);
      if (outcome === "not_found")
        throw new LoopError("TASK_NOT_FOUND", `task ${params.task_id} not found`);
      const suffix =
        outcome === "future_deleted_current_running"
          ? "Already dispatched work, if any, was not interrupted."
          : "No work was in flight.";
      return textResult(
        `Loop ${params.task_id} stopped. Future and locally pending fires were removed. ${suffix}\n${outcome}`,
      );
    },
  });

  pi.registerTool({
    name: "schedule_wakeup",
    label: "Schedule wakeup",
    description:
      "Only valid during the current scheduled dynamic iteration. Call exactly once with delay_seconds 60-3600, or stop=true. Do not call from ordinary user turns or fixed loops.",
    parameters: ScheduleWakeupParams,
    async execute(_id, params) {
      const text = scheduler.scheduleWakeup({
        delay_seconds: params.delay_seconds,
        stop: params.stop,
      });
      return textResult(text);
    },
  });
}

function formatCreate(result: {
  task_id: string;
  kind: string;
  schedule: string;
  next_fire_at: string | null;
  expires_at: string | null;
  pending: boolean;
  adjustment: string | null;
}): string {
  const parts = [
    `Loop ${result.task_id} (${result.kind})`,
    `schedule=${result.schedule}`,
    `next=${result.next_fire_at ?? (result.pending ? "waiting for idle" : "first iteration")}`,
  ];
  if (result.expires_at) parts.push(`expires=${result.expires_at}`);
  if (result.pending) parts.push("pending until the session is idle");
  if (result.adjustment) parts.push(result.adjustment);
  return parts.join("; ");
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

export { LoopError } from "./cron";
export { SessionLoopScheduler } from "./scheduler";
