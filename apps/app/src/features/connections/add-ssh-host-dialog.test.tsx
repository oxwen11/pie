// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { AddSshHostDialog } from "@/features/connections/add-ssh-host-dialog";
import { LOCAL_ENVIRONMENT_ID, type PlatformSsh } from "@/platform";
import { PlatformProvider } from "@/platform-provider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const hangingSnapshot = {
  revision: 0,
  activeId: LOCAL_ENVIRONMENT_ID,
  connectingLabel: null,
  remotes: [],
} as const;

const hangingSsh: PlatformSsh = {
  client: { available: true },
  environments: {
    getSnapshot: () => hangingSnapshot,
    subscribe: () => () => {},
  },
  discoverHosts: () => new Promise(() => {}),
  connect: () => Promise.resolve(),
  disconnect: () => Promise.resolve(),
  remove: () => Promise.resolve(),
};

const renderDialog = async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(
        PlatformProvider,
        { value: { ssh: hangingSsh } },
        createElement(AddSshHostDialog, { onClose: () => {} }),
      ),
    );
  });
};

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("AddSshHostDialog", () => {
  it("shows the form before host discovery resolves", async () => {
    await renderDialog();
    expect(document.body.textContent).toContain("Add SSH host");
    expect(document.getElementById("ssh-target")).not.toBeNull();
  });
});
