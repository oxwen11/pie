import type { SessionRef } from "@getpie/contract";
import { describe, expect, it } from "vitest";

import { ContentPanel } from "@/components/layout/content-panel/model/content-panel";
import { definePanelFamily } from "@/components/layout/content-panel/model/panel";

import { parsePluginIframePayload, pluginIframeSrc } from "./plugin-iframe";

const sessionA: SessionRef = {
  projectId: "11111111-1111-4111-8111-111111111111",
  sessionId: "session-a",
};
const sessionB: SessionRef = {
  projectId: "11111111-1111-4111-8111-111111111111",
  sessionId: "session-b",
};

const demoUrl = "/plugins/demo/index.html";
const demoTitle = "Demo";

const pluginIframe = definePanelFamily({
  type: "plugin-iframe",
  key: (payload: { url: string; title: string }) => payload.url,
  label: (payload) => payload.title,
  title: "Plugin",
  parse: parsePluginIframePayload,
  view: null,
});

describe("plugin iframe payload", () => {
  it("accepts url and title and rejects a bare sessionId", () => {
    expect(parsePluginIframePayload({ url: demoUrl, title: demoTitle })).toEqual({
      url: demoUrl,
      title: demoTitle,
    });
    expect(parsePluginIframePayload({ sessionId: "session-a" })).toBeNull();
    expect(parsePluginIframePayload({ url: demoUrl })).toBeNull();
  });
});

describe("pluginIframeSrc", () => {
  it("appends the complete SessionRef onto a user-dir plugin url", () => {
    expect(pluginIframeSrc(demoUrl, sessionA)).toBe(
      `${demoUrl}?projectId=${sessionA.projectId}&sessionId=${sessionA.sessionId}`,
    );
  });
});

describe("plugin-iframe ContentPanel", () => {
  it("opens and docks on the current SessionRef only", () => {
    const host = new ContentPanel<null>();
    host.register(pluginIframe);
    host.open(sessionA, pluginIframe, { url: demoUrl, title: demoTitle });

    const open = host.snapshot(host.store.getState(), sessionA);
    expect(open.presentation).toBe("docked");
    expect(open.active?.id).toBe(`plugin-iframe:${demoUrl}`);
    expect(open.panels).toHaveLength(1);

    const other = host.snapshot(host.store.getState(), sessionB);
    expect(other.presentation).toBe("hidden");
    expect(other.panels).toHaveLength(0);
  });
});
