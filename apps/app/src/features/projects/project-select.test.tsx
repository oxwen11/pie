import type { Project } from "@getpie/contract";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { ProjectSelect } from "./project-select";

const project = (id: string): Project => ({
  id,
  name: id,
  path: `/tmp/${id}`,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const projects = [project("p-one"), project("p-two")];

async function openPicker(): Promise<void> {
  await page.getByRole("combobox").click();
}

describe("ProjectSelect", () => {
  it("keeps null mode locally: clear affordance and Don't-work button", async () => {
    await render(<ProjectSelect onChange={() => {}} projects={projects} value="p-one" />);
    expect(document.querySelector('[aria-label="Clear project"]')).not.toBeNull();
    await openPicker();
    expect(document.body.textContent).toContain("p-two");
    expect(document.body.textContent).toContain("Don't work in a project");
  });

  it("requireProject (linked host) hides every path back to null", async () => {
    await render(
      <ProjectSelect onChange={() => {}} projects={projects} requireProject value="p-one" />,
    );
    expect(document.querySelector('[aria-label="Clear project"]')).toBeNull();
    await openPicker();
    expect(document.body.textContent).toContain("p-two");
    expect(document.body.textContent).not.toContain("Don't work in a project");
  });
});
