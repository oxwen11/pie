import type { PullRequestDemandInput } from "@getpie/contract/pull-request";
import { ORPCError } from "@orpc/client";
import { afterEach, expect, it, vi } from "vitest";

import { PullRequestDemand } from "./pull-request-demand";

type Send = ConstructorParameters<typeof PullRequestDemand>[0];
const a = { projectId: "a", sessionId: "same" };
const b = { projectId: "b", sessionId: "same" };
const response = (leaseId = "lease") => ({
  leaseId,
  expiresAt: new Date(Date.now() + 90_000).toISOString(),
});
const tick = () => vi.advanceTimersByTimeAsync(0);
afterEach(() => vi.useRealTimers());

it("unions visible rows and panels per connection, renews once at 30s, and releases hidden demand", async () => {
  vi.useFakeTimers();
  const send = vi.fn<Send>().mockImplementation(async () => response());
  const demand = new PullRequestDemand(send);
  const sidebar = Symbol();
  const panel = Symbol();
  demand.replace(sidebar, [a, b]);
  demand.replace(panel, [a]);
  await tick();
  expect(send).not.toHaveBeenCalled();
  demand.setVisible(true);
  await tick();
  expect(send).toHaveBeenLastCalledWith({ version: 1, refs: [a, b] });
  demand.replace(sidebar, []);
  await tick();
  expect(send).toHaveBeenLastCalledWith({ version: 2, refs: [a], leaseId: "lease" });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(send).toHaveBeenLastCalledWith({ version: 3, refs: [a], leaseId: "lease" });
  demand.setVisible(false);
  await tick();
  expect(send).toHaveBeenLastCalledWith({ version: 4, refs: [], leaseId: "lease" });
  await vi.advanceTimersByTimeAsync(90_000);
  expect(send).toHaveBeenCalledTimes(4);
});

it("serializes a hidden release behind an in-flight acquisition", async () => {
  vi.useFakeTimers();
  let complete!: (value: ReturnType<typeof response>) => void;
  const pending = new Promise<ReturnType<typeof response>>((resolve) => {
    complete = resolve;
  });
  const send = vi
    .fn<Send>()
    .mockReturnValueOnce(pending)
    .mockImplementation(async () => response());
  const demand = new PullRequestDemand(send);
  demand.setVisible(true);
  demand.replace(Symbol(), [a]);
  await tick();
  demand.setVisible(false);
  await tick();
  expect(send).toHaveBeenCalledOnce();
  complete(response());
  await tick();
  expect(send).toHaveBeenLastCalledWith({ version: 2, refs: [], leaseId: "lease" });
  expect(vi.getTimerCount()).toBe(0);
});

it("repairs a restarted server on reconnect, without reviving hidden demand", async () => {
  vi.useFakeTimers();
  const send = vi.fn<Send>().mockImplementation(async (input: PullRequestDemandInput) => {
    if (input.leaseId) throw new ORPCError("INVALID_LEASE");
    return response();
  });
  const demand = new PullRequestDemand(send);
  demand.setVisible(true);
  demand.replace(Symbol(), [a]);
  await tick();
  demand.reconnect();
  await tick();
  expect(send).toHaveBeenLastCalledWith({ version: 3, refs: [a] });
  demand.setVisible(false);
  await tick();
  demand.reconnect();
  await tick();
  expect(send).toHaveBeenCalledTimes(4);
});

it("discards expired capabilities after suspension and never retries hidden failures", async () => {
  vi.useFakeTimers();
  const send = vi.fn<Send>().mockImplementation(async () => response());
  const demand = new PullRequestDemand(send);
  demand.setVisible(true);
  demand.replace(Symbol(), [a]);
  await tick();
  vi.setSystemTime(Date.now() + 91_000);
  demand.reconnect();
  await tick();
  expect(send).toHaveBeenLastCalledWith({ version: 2, refs: [a] });
  send.mockRejectedValue(new Error("offline"));
  demand.setVisible(false);
  await tick();
  await vi.advanceTimersByTimeAsync(180_000);
  expect(send).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});
