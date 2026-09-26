import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { DraftEnvironmentSelect } from "./draft-environment-select";
import type { ConnectedEnvironment } from "./use-connected-environments";

const environment = (
  environmentId: string,
  title: string,
  kind: ConnectedEnvironment["kind"],
): ConnectedEnvironment => ({
  environmentId,
  title,
  description: kind === "local" ? "This device" : environmentId,
  kind,
});

describe("DraftEnvironmentSelect", () => {
  it("stays hidden when only this device is connected", async () => {
    await render(
      <DraftEnvironmentSelect
        environments={[environment("local", "This device", "local")]}
        onChange={() => {}}
        value="local"
      />,
    );
    expect(document.querySelector('[aria-label="Environment"]')).toBeNull();
  });

  it("lists connected environments and emits the picked id", async () => {
    const picked: string[] = [];
    await render(
      <DraftEnvironmentSelect
        environments={[
          environment("local", "This device", "local"),
          environment("remote", "macbook-pro-m1", "remote"),
        ]}
        onChange={(environmentId) => {
          picked.push(environmentId);
        }}
        value="local"
      />,
    );
    await page.getByRole("combobox", { name: "Environment" }).click();
    await page.getByText("macbook-pro-m1").click();
    expect(picked).toEqual(["remote"]);
  });
});
