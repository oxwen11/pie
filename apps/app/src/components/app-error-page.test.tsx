import type { ReactElement } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { AppErrorPage } from "./app-error-page";

describe("AppErrorPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the error and a reload action", async () => {
    await render(<AppErrorPage error={new Error("session boom")} />);

    await expect
      .element(page.getByRole("heading", { name: "Pie ran into a problem" }))
      .toBeVisible();
    await expect.element(page.getByText("session boom")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Reload" })).toBeVisible();
  });

  it("catches a child render error as the outermost fallback", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    function Boom(): ReactElement {
      throw new Error("provider boom");
    }

    await render(
      <ErrorBoundary FallbackComponent={AppErrorPage}>
        <Boom />
      </ErrorBoundary>,
    );

    await expect.element(page.getByText("Pie ran into a problem")).toBeVisible();
    await expect.element(page.getByText("provider boom")).toBeVisible();
    await expect.element(page.getByText("Something went wrong!")).not.toBeInTheDocument();
  });
});
