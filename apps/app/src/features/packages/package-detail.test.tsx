import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { PackageDetail } from "./package-detail";
import { detailFromInstalled } from "./package-model";

it("removes the selected installed source, not a different package with the same display name", async () => {
  const selected = { source: "npm:@scope/tool", installed: true };
  const removed: string[] = [];
  await render(
    <PackageDetail
      addingSource={undefined}
      detail={detailFromInstalled(selected, [])}
      items={[{ source: "npm:tool", installed: true }, selected]}
      onAdd={() => {
        throw new Error("An installed package must not be offered for installation");
      }}
      onRemove={(source) => removed.push(source)}
      removingSource={undefined}
    />,
  );
  await page.getByRole("button", { name: "Remove package" }).click();
  expect(removed).toEqual([selected.source]);
});
