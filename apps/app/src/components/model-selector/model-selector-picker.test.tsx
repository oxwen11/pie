import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { ModelSelectorPicker } from "./model-selector-picker";

const models = [{ provider: "anthropic", modelId: "claude", name: "Claude" }];

describe("ModelSelectorPicker", () => {
  it("shows a failed listing with a Retry action", async () => {
    const onRetry = vi.fn<() => void>();
    await render(
      <ModelSelectorPicker
        aria-label="Model"
        error="Pi did not answer the discovery request in time"
        modelId={undefined}
        models={[]}
        onChange={() => undefined}
        onRetry={onRetry}
        providerId={undefined}
      />,
    );

    await expect.element(page.getByText("Models failed to load.")).toBeInTheDocument();
    await page.getByRole("combobox", { name: "Model" }).click();

    const alert = page.getByRole("alert");
    await expect.element(alert.getByText("Couldn't load models")).toBeVisible();
    await expect
      .element(alert.getByText("Pi did not answer the discovery request in time"))
      .toBeVisible();
    await expect.element(page.getByText("No matching models.")).not.toBeInTheDocument();
    await alert.getByRole("button", { name: "Retry" }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps the failure and Retry focus while a retry is in flight", async () => {
    const onRetry = vi.fn<() => void>();
    const picker = (props: { error?: string; loading?: boolean; listed?: typeof models }) => (
      <ModelSelectorPicker
        aria-label="Model"
        error={props.error}
        loading={props.loading}
        modelId={undefined}
        models={props.listed ?? []}
        onChange={() => undefined}
        onRetry={onRetry}
        providerId={undefined}
      />
    );
    const screen = await render(picker({ error: "Pi process exited" }));
    await page.getByRole("combobox", { name: "Model" }).click();
    const alert = page.getByRole("alert");
    await alert.getByRole("button", { name: "Retry" }).click();

    // A refetch resets the query error before it settles.
    await screen.rerender(picker({ loading: true }));
    const retrying = alert.getByRole("button", { name: "Retrying…" });
    await expect.element(retrying).toHaveFocus();
    await expect.element(alert.getByText("Pi process exited")).toBeVisible();
    await expect.element(page.getByText("No matching models.")).not.toBeInTheDocument();
    await retrying.click();
    expect(onRetry).toHaveBeenCalledOnce();

    await screen.rerender(picker({ listed: models }));
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
    await expect.element(page.getByRole("option", { name: "Claude" })).toBeVisible();
  });

  it("says models are loading on the first fetch", async () => {
    await render(
      <ModelSelectorPicker
        aria-label="Model"
        loading
        modelId={undefined}
        models={[]}
        onChange={() => undefined}
        providerId={undefined}
      />,
    );

    await page.getByRole("combobox", { name: "Model" }).click();

    await expect.element(page.getByText("Loading models…")).toBeVisible();
    await expect.element(page.getByText("No matching models.")).not.toBeInTheDocument();
  });

  it("lists models without an error notice", async () => {
    await render(
      <ModelSelectorPicker
        aria-label="Model"
        modelId={undefined}
        models={models}
        onChange={() => undefined}
        providerId={undefined}
      />,
    );

    await page.getByRole("combobox", { name: "Model" }).click();

    await expect.element(page.getByRole("option", { name: "Claude" })).toBeVisible();
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
    await expect.element(page.getByText("Models failed to load.")).not.toBeInTheDocument();
  });
});
