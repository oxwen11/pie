import type { Project } from "@getpie/contract";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { ProjectSelect, type ProjectGroup, type ProjectSelection } from "./project-select";

const project = (id: string): Project => ({
  id,
  name: id,
  path: `/tmp/${id}`,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const localGroup: ProjectGroup = {
  environmentId: "env-local",
  environmentTitle: "This device",
  projects: [project("p-one"), project("p-two")],
};

const remoteGroup: ProjectGroup = {
  environmentId: "env-remote",
  environmentTitle: "macbook-pro-m1",
  projects: [project("p-r1")],
};

async function openPicker(): Promise<void> {
  await page.getByRole("combobox").click();
}

describe("ProjectSelect", () => {
  it("keeps null mode locally: clear affordance and Don't-work button", async () => {
    await render(
      <ProjectSelect
        groups={[localGroup]}
        onChange={() => {}}
        value={{ environmentId: "env-local", projectId: "p-one" }}
      />,
    );
    expect(document.querySelector('[aria-label="Clear project"]')).not.toBeNull();
    await openPicker();
    expect(document.body.textContent).toContain("p-two");
    expect(document.body.textContent).toContain("Don't work in a project");
    expect(document.body.textContent).not.toContain("This device");
  });

  it("requireProject (linked host) hides every path back to null", async () => {
    await render(
      <ProjectSelect
        groups={[remoteGroup]}
        onChange={() => {}}
        requireProject
        value={{ environmentId: "env-remote", projectId: "p-r1" }}
      />,
    );
    expect(document.querySelector('[aria-label="Clear project"]')).toBeNull();
    await openPicker();
    expect(document.body.textContent).toContain("p-r1");
    expect(document.body.textContent).not.toContain("Don't work in a project");
  });

  it("labels each environment and emits the owning environment on pick", async () => {
    const onChange = vi.fn<(next: ProjectSelection | null) => void>();
    await render(
      <ProjectSelect
        group
        groups={[localGroup, remoteGroup]}
        onChange={onChange}
        value={{ environmentId: "env-local", projectId: "p-one" }}
      />,
    );
    await openPicker();
    expect(document.body.textContent).toContain("This device");
    expect(document.body.textContent).toContain("macbook-pro-m1");
    expect(document.body.textContent).toContain("p-r1");
    await page.getByText("p-r1").click();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentId: "env-remote",
        project: expect.objectContaining({ id: "p-r1" }),
      }),
    );
  });
});
