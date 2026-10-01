declare module "vitest/browser" {
  interface LocatorSelectors {
    getBySlot: (slot: string) => import("vitest/browser").Locator;
    getSubmitButton: () => import("vitest/browser").Locator;
  }
}
