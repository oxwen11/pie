import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";

import "@/index.css";

import { AssistantMessage } from "./assistant-message";

const imagePart = (src: string) => ({
  type: "file" as const,
  mediaType: "image/png",
  filename: "result.png",
  url: src,
});

afterEach(() => document.documentElement.classList.remove("dark"));

describe("AssistantMessage", () => {
  it.each([
    { theme: "light", width: 390 },
    { theme: "dark", width: 390 },
    { theme: "light", width: 1280 },
    { theme: "dark", width: 1280 },
  ])(
    "opens a translucent black preview in $theme mode at $width px with working controls",
    async ({ theme, width }) => {
      await page.viewport(width, 800);
      document.documentElement.classList.toggle("dark", theme === "dark");
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 1200;
      const src = canvas.toDataURL("image/png");
      await render(
        <AssistantMessage parts={[imagePart(src)]} isStreaming={false} showActions={false} />,
      );

      const image = page.getByRole("img").element();
      expect(image.getAttribute("src")).toBe(src);
      expect(image.className).toContain("max-h-44");
      expect(image.className).toContain("sm:max-w-xs");

      const trigger = page.getByRole("button", { name: "Expand image: result.png" });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "result.png" });
      await expect.element(dialog).toBeVisible();
      await expect.element(dialog).not.toHaveAttribute("data-starting-style");
      await expect.poll(() => dialog.element().getAnimations().length).toBe(0);
      await expect
        .element(dialog.getByRole("heading", { name: "result.png" }))
        .toHaveClass(/sr-only/);
      expect(dialog.element().textContent?.trim()).toBe("result.png");
      expect(dialog.element().querySelectorAll("button")).toHaveLength(3);

      const preview = dialog.getByRole("img");
      await expect.element(preview).toHaveAttribute("src", src);
      const stage = dialog.getByRole("region", { name: "Image canvas" });
      const zoomIn = dialog.getByRole("button", { name: "Zoom in" });
      const zoomOut = dialog.getByRole("button", { name: "Zoom out" });
      await expect.element(zoomIn).toBeEnabled();
      const close = dialog.getByRole("button", { name: "Close image preview" });
      for (const control of [close, zoomIn, zoomOut]) {
        const bounds = control.element().getBoundingClientRect();
        expect(bounds.width).toBe(44);
        expect(bounds.height).toBe(44);
      }
      expect(getComputedStyle(dialog.element()).backgroundColor).toBe("rgba(0, 0, 0, 0.8)");
      expect(getComputedStyle(dialog.element()).color).toBe("rgb(255, 255, 255)");
      expect(preview.element().getBoundingClientRect().width).toBeLessThanOrEqual(
        stage.element().clientWidth,
      );
      expect(preview.element().getBoundingClientRect().height).toBeLessThanOrEqual(
        stage.element().clientHeight,
      );

      const fitWidth = preview.element().getBoundingClientRect().width;
      await zoomIn.click();
      expect(preview.element().getBoundingClientRect().width).toBeCloseTo(fitWidth * 1.25, 0);
      await zoomOut.click();
      expect(preview.element().getBoundingClientRect().width).toBeCloseTo(fitWidth, 0);
      for (let i = 0; i < 7; i++) await zoomIn.click();
      expect(stage.element().scrollWidth).toBeGreaterThan(stage.element().clientWidth);

      const bounds = dialog.element().getBoundingClientRect();
      const closeBounds = close.element().getBoundingClientRect();
      expect(closeBounds.right).toBeGreaterThan(bounds.right - 24);
      expect(closeBounds.top).toBeLessThan(bounds.top + 24);
      const plusBounds = zoomIn.element().getBoundingClientRect();
      const minusBounds = zoomOut.element().getBoundingClientRect();
      expect((minusBounds.left + plusBounds.right) / 2).toBeCloseTo(
        (bounds.left + bounds.right) / 2,
        0,
      );
      expect(plusBounds.bottom).toBeGreaterThan(bounds.bottom - 24);
      await close.click();
      await expect.element(dialog).not.toBeInTheDocument();
      await expect.element(trigger).toHaveFocus();
      await trigger.click();
      await expect.element(dialog).not.toHaveAttribute("data-starting-style");
      await expect.poll(() => dialog.element().getAnimations().length).toBe(0);
      await expect.element(zoomIn).toBeEnabled();
      expect(preview.element().getBoundingClientRect().width).toBeCloseTo(fitWidth, 0);
      await userEvent.keyboard("{Escape}");
      await expect.element(dialog).not.toBeInTheDocument();
      await expect.element(trigger).toHaveFocus();
    },
  );

  it("shows failed images safely and disables zoom controls", async () => {
    await render(
      <AssistantMessage
        parts={[imagePart("data:image/png;base64,invalid")]}
        isStreaming={false}
        showActions={false}
      />,
    );
    await page.getByRole("button", { name: "Expand image: result.png" }).click();
    const dialog = page.getByRole("dialog");
    await expect
      .element(dialog.getByRole("region", { name: "Image canvas" }).getByRole("status"))
      .toHaveTextContent("Image unavailable");
    await expect.element(dialog.getByRole("button", { name: "Zoom in" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Close image preview" }).click();
  });

  it("does not render SVG file parts", async () => {
    await render(
      <AssistantMessage
        parts={[
          { type: "file", mediaType: "image/svg+xml", url: "data:image/svg+xml;base64,PHN2Zy8+" },
        ]}
        isStreaming={false}
        showActions={false}
      />,
    );
    await expect.element(page.getByRole("img")).not.toBeInTheDocument();
  });
});
