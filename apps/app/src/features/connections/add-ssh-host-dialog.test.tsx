// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { AddSshHostDialog } from "@/features/connections/add-ssh-host-dialog";
import { composeSshConnectTarget } from "@/features/connections/ssh-connect-target";
import type { PlatformSsh } from "@/platform";
import { PlatformProvider } from "@/platform-provider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const hangingSnapshot = {
  revision: 0,
  connecting: [],
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

describe("composeSshConnectTarget", () => {
  it("merges host/username/port into a connect string", () => {
    expect(composeSshConnectTarget({ host: "devbox", username: "dinq", port: "22" })).toBe(
      "dinq@devbox:22",
    );
    expect(composeSshConnectTarget({ host: "dinq@macbook-pro-m1", username: "", port: "" })).toBe(
      "dinq@macbook-pro-m1",
    );
    expect(composeSshConnectTarget({ host: "host.example:2222", username: "root", port: "" })).toBe(
      "root@host.example:2222",
    );
  });
});

describe("AddSshHostDialog", () => {
  it("shows the T3-style form before host discovery resolves", async () => {
    await renderDialog();
    expect(document.body.textContent).toContain("Add SSH host");
    expect(document.body.textContent).toContain("Add environment");
    expect(document.getElementById("ssh-host")).not.toBeNull();
    expect(document.getElementById("ssh-username")).not.toBeNull();
    expect(document.getElementById("ssh-port")).not.toBeNull();
  });
});
