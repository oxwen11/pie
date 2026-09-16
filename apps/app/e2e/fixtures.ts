import { expect, test as base } from "@playwright/test";

export type PieE2E = {
  httpBaseUrl: string;
  sample: string;
  sampleGit: string;
  fakeReply: string;
};

export function pieE2E(): PieE2E {
  const httpBaseUrl = process.env.PIE_E2E_BASE_URL;
  if (httpBaseUrl === undefined) {
    throw new Error("PIE_E2E_BASE_URL is not set; Playwright globalSetup did not run");
  }
  return {
    httpBaseUrl,
    sample: process.env.PIE_E2E_SAMPLE ?? "sample",
    sampleGit: process.env.PIE_E2E_SAMPLE_GIT ?? "sample-git",
    fakeReply: process.env.PIE_E2E_FAKE_REPLY ?? "E2E fake Pi reply",
  };
}

export const test = base.extend<{ pie: PieE2E }>({
  // oxlint-disable-next-line no-empty-pattern -- required by Playwright's fixture API
  pie: async ({}, use) => {
    await use(pieE2E());
  },
});

export { expect };
