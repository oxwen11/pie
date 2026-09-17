import type { SessionRef } from "@getpie/contract";
import { describe, expect, it } from "vitest";

import { ContentPanel } from "@/components/layout/content-panel/model/content-panel";
import { definePanel } from "@/components/layout/content-panel/model/panel";

import {
  parsePluginIframePayload,
  PLUGIN_DEMO_TITLE,
  PLUGIN_DEMO_URL,
  pluginIframeSrc,
} from "./plugin-iframe";

const sessionA: SessionRef = {
  projectId: "11111111-1111-4111-8111-111111111111",
  sessionId: "session-a",
};
const sessionB: SessionRef = {
  projectId: "11111111-1111-4111-8111-111111111111",
  sessionId: "session-b",
};

const pluginIframe = definePanel({
  type: "plugin-iframe",
  label: "Demo",
  parse: parsePluginIframePayload,
  view: null,
});

describe("plugin iframe payload", () => {
  it("accepts url and title and rejects a bare sessionId", () => {
    expect(parsePluginIframePayload({ url: PLUGIN_DEMO_URL, title: PLUGIN_DEMO_TITLE })).toEqual({
      url: PLUGIN_DEMO_URL,
      title: PLUGIN_DEMO_TITLE,
    });
    expect(parsePluginIframePayload({ sessionId: "session-a" })).toBeNull();
    expect(parsePluginIframePayload({ url: PLUGIN_DEMO_URL })).toBeNull();
  });
});

describe("pluginIframeSrc", () => {
  it("appends the complete SessionRef onto a relative dogfood url", () => {
    expect(pluginIframeSrc(PLUGIN_DEMO_URL, sessionA)).toBe(
      `${PLUGIN_DEMO_URL}?projectId=${sessionA.projectId}&sessionId=${sessionA.sessionId}`,
    );
  });
});

describe("plugin-iframe ContentPanel", () => {
  it("opens and docks on the current SessionRef only", () => {
    const host = new ContentPanel<null>();
    host.register(pluginIframe);
    host.open(sessionA, pluginIframe, { url: PLUGIN_DEMO_URL, title: PLUGIN_DEMO_TITLE });

    const open = host.snapshot(host.store.getState(), sessionA);
    expect(open.presentation).toBe("docked");
    expect(open.active?.id).toBe("plugin-iframe");
    expect(open.panels).toHaveLength(1);

    const other = host.snapshot(host.store.getState(), sessionB);
    expect(other.presentation).toBe("hidden");
    expect(other.panels).toHaveLength(0);
  });
});
