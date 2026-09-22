import type { Schedule } from "@getpie/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

// oxlint-disable-next-line anti-slop/no-module-mocking -- the form reads catalog queries; this test only checks which fields each variant submits
vi.mock("@/lib/environment-orpc", () => ({
  useEnvironmentOrpc: () => ({
    agent: {
      listModels: {
        queryOptions: () => ({
          queryFn: async () => ({ models: [] }),
          queryKey: ["agent", "listModels"],
        }),
      },
      session: {
        list: {
          queryOptions: () => ({
            queryFn: async () => [],
            queryKey: ["agent", "session", "list"],
          }),
        },
      },
    },
  }),
}));

import { ScheduleCreateForm, ScheduleEditForm, type ScheduleFormSubmit } from "./schedule-form";

const projectId = "0195b4b3-6dc4-7d41-a9ce-3ab5dcb6cc61";

const schedule: Schedule = {
  createdAt: "2026-09-01T00:00:00.000Z",
  enabled: true,
  id: projectId,
  name: "Nightly",
  nextRunAt: null,
  projectId,
  prompt: "review",
  runs: [],
  spec: { kind: "manual" },
  updatedAt: "2026-09-01T00:00:00.000Z",
};

function renderForm(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

describe("schedule form variants", () => {
  it("offers Run now only when creating a schedule", async () => {
    const onSubmit = vi.fn<(value: ScheduleFormSubmit) => void>();
    await renderForm(
      <ScheduleCreateForm
        onCancel={() => undefined}
        onSubmit={onSubmit}
        projects={[{ id: projectId, name: "Pie" }]}
      />,
    );

    await expect.element(page.getByRole("button", { name: "Create" })).toBeVisible();
    await expect.element(page.getByText("Run now")).toBeVisible();

    await page.getByLabelText("Name").fill("Nightly");
    await page.getByLabelText("Prompt").fill("review");
    await page.getByText("Run now").click();
    await page.getByRole("button", { name: "Create" }).click();

    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ name: "Nightly", runNow: true });
  });

  it("saves an existing schedule without a run-now field", async () => {
    const onSubmit = vi.fn<(value: ScheduleFormSubmit) => void>();
    await renderForm(
      <ScheduleEditForm
        onCancel={() => undefined}
        onSubmit={onSubmit}
        projects={[{ id: projectId, name: "Pie" }]}
        schedule={schedule}
      />,
    );

    await expect.element(page.getByRole("button", { name: "Save" })).toBeVisible();
    await expect.element(page.getByRole("switch", { name: "Run now" })).not.toBeInTheDocument();

    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ name: "Nightly", runNow: false });
  });
});
