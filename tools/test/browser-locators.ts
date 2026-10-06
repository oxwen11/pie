import { locators } from "vitest/browser";

locators.extend({
  getBySlot(slot: string) {
    return `[data-slot="${slot}"]`;
  },
  getSubmitButton() {
    return "form button[type='submit']";
  },
});

declare module "vitest/browser" {
  interface LocatorSelectors {
    getBySlot: (slot: string) => import("vitest/browser").Locator;
    getSubmitButton: () => import("vitest/browser").Locator;
  }
}
