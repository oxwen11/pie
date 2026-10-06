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
    "opens a zoomable preview on a translucent black backdrop in $theme mode at $width px",
    async ({ theme, width }) => {
      await page.viewport(width, 800);
      document.documentElement.classList.toggle("dark", theme === "dark");
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 1200;
      const src = canvas.toDataURL("image/png");
      await render(
        <div className="mx-auto w-full max-w-4xl p-4">
          <AssistantMessage parts={[imagePart(src)]} isStreaming={false} showActions={false} />
        </div>,
      );

      const image = page.getByRole("img", { name: "result.png" });
      await expect.element(image).toHaveAttribute("src", src);
      await expect.element(image).toHaveClass(/max-h-\[30rem\]/);
      await expect.element(image).toHaveClass(/rounded-lg/);

      await expect
        .element(page.getByRole("button", { name: "Expand image: result.png" }))
        .toBeInTheDocument();
      await image.click();
      const dialog = page.getByRole("dialog");
      const modal = await dialog.findElement();
      await expect.element(dialog).toHaveClass(/chat-image-preview-dialog/);
      const overlay = dialog.element().querySelector('[data-rmiz-modal-overlay="visible"]');
      if (!(overlay instanceof HTMLElement)) throw new Error("Image preview did not open");
      await expect
        .poll(() => getComputedStyle(overlay).backgroundColor)
        .toBe("rgba(0, 0, 0, 0.75)");
      const zoomed = dialog.element().querySelector("[data-rmiz-modal-img]");
      if (!(zoomed instanceof HTMLElement)) throw new Error("Zoomed image is missing");
      expect(zoomed.getAttribute("src")).toBe(src);
      expect(getComputedStyle(zoomed).borderRadius).not.toBe("0px");
      // Never zoom to less than the thumbnail it came from, at any width.
      const zoomedBox = zoomed.getBoundingClientRect();
      expect(zoomedBox.width).toBeGreaterThanOrEqual(
        image.element().getBoundingClientRect().width - 0.5,
      );

      const unzoom = dialog.getByRole("button", { name: "Minimize image" });
      const bounds = unzoom.element().getBoundingClientRect();
      expect(bounds.width).toBe(44);
      expect(bounds.height).toBe(44);
      expect(getComputedStyle(unzoom.element()).backgroundColor).toBe("rgba(0, 0, 0, 0.65)");

      await userEvent.keyboard("{Escape}");
      await expect.poll(() => modal.hasAttribute("open")).toBe(false);
    },
  );

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
