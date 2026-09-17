import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { ModelErrorCard } from "./model-error-card";

describe("ModelErrorCard", () => {
  it("turns a provider rate-limit response into a readable card", async () => {
    await render(
      <ModelErrorCard
        error={
          new Error(
            '429: {"code":"1308","message":"已达到 5 小时的使用上限。您的限额将在 2026-08-28 00:08:44 重置。"}',
          )
        }
      />,
    );

    await expect.element(page.getByRole("alert")).toBeVisible();
    await expect.element(page.getByText("Model usage limit reached")).toBeVisible();
    await expect.element(page.getByText(/已达到 5 小时的使用上限/)).toBeVisible();
    await expect.element(page.getByText("HTTP 429")).not.toBeInTheDocument();
    await expect.element(page.getByText("1308")).not.toBeInTheDocument();
    await expect.element(page.getByText('{"code"')).not.toBeInTheDocument();
  });

  it("keeps an unstructured error readable", async () => {
    await render(
      <ModelErrorCard error={new Error("Connection lost while contacting the model")} />,
    );

    await expect.element(page.getByText("Model request failed")).toBeVisible();
    await expect
      .element(page.getByText("Connection lost while contacting the model"))
      .toBeVisible();
    await expect.element(page.getByText("HTTP")).not.toBeInTheDocument();
  });
});
