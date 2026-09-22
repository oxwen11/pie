import type { PullRequestActionInput } from "@getpie/contract/pull-request";
import { ORPCError } from "@orpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { usePullRequestAction } from "./use-pull-request-action";

const input: PullRequestActionInput = {
  action: { type: "merge", method: "squash" },
  expected: {
    headSha: "abc",
    pullRequest: { host: "github.com", owner: "acme", repository: "pie", number: 1 },
  },
  ref: { host: "github.com", owner: "acme", repository: "pie", number: 1 },
};

function ActionProbe({
  call,
  detailIsError,
}: {
  readonly call: (value: PullRequestActionInput) => Promise<unknown>;
  readonly detailIsError: boolean;
}) {
  const [detailFetches, setDetailFetches] = useState(0);
  const [diffFetches, setDiffFetches] = useState(0);
  const [applied, setApplied] = useState(0);
  const [ran, setRan] = useState(0);
  const action = usePullRequestAction({
    mutationFn: async (value) => {
      setRan((count) => count + 1);
      return call(value);
    },
    mutationKey: ["pullRequest", "runAction"],
    onApplied: () => setApplied((count) => count + 1),
    refetchDetail: async () => {
      setDetailFetches((count) => count + 1);
      return { isError: detailIsError };
    },
    refetchDiff: async () => {
      setDiffFetches((count) => count + 1);
    },
  });

  return (
    <div>
      <button onClick={() => action.run(input)} type="button">
        Run
      </button>
      <button onClick={() => action.refresh()} type="button">
        Refresh
      </button>
      <span>{action.postActionRefreshFailed ? "refresh-failed" : "refresh-ok"}</span>
      <span>{`detail ${detailFetches}`}</span>
      <span>{`diff ${diffFetches}`}</span>
      <span>{`applied ${applied}`}</span>
      <span>{`ran ${ran}`}</span>
    </div>
  );
}

function renderProbe(
  call: (value: PullRequestActionInput) => Promise<unknown>,
  detailIsError: boolean,
) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const ui = (failed: boolean) => (
    <QueryClientProvider client={queryClient}>
      <ActionProbe call={call} detailIsError={failed} />
    </QueryClientProvider>
  );
  return render(ui(detailIsError)).then((screen) => ({
    ...screen,
    rerenderFailed: (failed: boolean) => screen.rerender(ui(failed)),
  }));
}

describe("usePullRequestAction", () => {
  it("refetches detail and diff after a successful action and records a failed refresh", async () => {
    await renderProbe(async () => undefined, true);
    await page.getByRole("button", { name: "Run" }).click();

    await expect.element(page.getByText("ran 1")).toBeVisible();
    await expect.element(page.getByText("applied 1")).toBeVisible();
    await expect.element(page.getByText("detail 1")).toBeVisible();
    await expect.element(page.getByText("diff 1")).toBeVisible();
    await expect.element(page.getByText("refresh-failed")).toBeVisible();
  });

  it("refreshes on a stale context error without treating the action as applied", async () => {
    await renderProbe(async () => {
      throw new ORPCError("STALE_CONTEXT", { message: "changed" });
    }, false);
    await page.getByRole("button", { name: "Run" }).click();

    await expect.element(page.getByText("ran 1")).toBeVisible();
    await expect.element(page.getByText("detail 1")).toBeVisible();
    await expect.element(page.getByText("diff 1")).toBeVisible();
    await expect.element(page.getByText("applied 0")).toBeVisible();
    await expect.element(page.getByText("refresh-ok")).toBeVisible();
  });

  it("leaves the pull request in place when the action fails for another reason", async () => {
    await renderProbe(async () => {
      throw new Error("rejected");
    }, false);
    await page.getByRole("button", { name: "Run" }).click();

    await expect.element(page.getByText("ran 1")).toBeVisible();
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    await expect.element(page.getByText("detail 0")).toBeVisible();
    await expect.element(page.getByText("diff 0")).toBeVisible();
    await expect.element(page.getByText("applied 0")).toBeVisible();
  });

  it("clears a failed post-action refresh once detail loads again", async () => {
    const screen = await renderProbe(async () => undefined, true);
    await page.getByRole("button", { name: "Run" }).click();
    await expect.element(page.getByText("refresh-failed")).toBeVisible();

    await screen.rerenderFailed(false);
    await page.getByRole("button", { name: "Refresh" }).click();

    await expect.element(page.getByText("detail 2")).toBeVisible();
    await expect.element(page.getByText("diff 2")).toBeVisible();
    await expect.element(page.getByText("refresh-ok")).toBeVisible();
  });
});
