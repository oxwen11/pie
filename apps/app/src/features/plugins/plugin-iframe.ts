import type { SessionRef } from "@getpie/contract";

import { asRecord } from "@/components/layout/content-panel/model/panel";

export interface PluginIframePayload {
  readonly url: string;
  readonly title: string;
}

export function parsePluginIframePayload(raw: unknown): PluginIframePayload | null {
  const { url, title } = asRecord(raw) ?? {};
  return typeof url === "string" && url.length > 0 && typeof title === "string" && title.length > 0
    ? { url, title }
    : null;
}

/** Bind the iframe URL to the complete SessionRef — never a bare sessionId. */
export function pluginIframeSrc(url: string, sessionRef: SessionRef): string {
  try {
    const absolute = new URL(url);
    absolute.searchParams.set("projectId", sessionRef.projectId);
    absolute.searchParams.set("sessionId", sessionRef.sessionId);
    return absolute.toString();
  } catch {
    const parsed = new URL(url, "https://plugin.invalid");
    parsed.searchParams.set("projectId", sessionRef.projectId);
    parsed.searchParams.set("sessionId", sessionRef.sessionId);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }
}
