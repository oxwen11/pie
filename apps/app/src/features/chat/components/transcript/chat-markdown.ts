import { defaultRemarkPlugins } from "streamdown";

export type MarkdownImageSource =
  | { type: "direct"; url: string }
  | { type: "session-file"; destination: string }
  | { type: "blocked" };

const RASTER_DATA_URL = /^data:image\/(?:bmp|gif|jpeg|png|webp);base64,/i;
const EXPLICIT_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const LOCAL_IMAGE_PREFIX = "https://pie-local.invalid/";

function isLocalMarkdownDestination(url: string): boolean {
  if (/^[a-z]:[\\/]/i.test(url) || url.startsWith(String.raw`\\`)) return true;
  if (/^(?:https?:|blob:)/i.test(url) || RASTER_DATA_URL.test(url)) return false;
  if (url.startsWith("~/") || url.startsWith("~\\") || url.startsWith("//")) return false;
  return /^file:/i.test(url) || !EXPLICIT_SCHEME.test(url);
}

function rewriteLocalMarkdownImages(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  const node = value as { type?: unknown; url?: unknown; children?: unknown };
  if (
    node.type === "image" &&
    typeof node.url === "string" &&
    isLocalMarkdownDestination(node.url)
  ) {
    node.url = `${LOCAL_IMAGE_PREFIX}${encodeURIComponent(node.url)}`;
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) rewriteLocalMarkdownImages(child);
  }
}

const localImageRemarkPlugin = () => (tree: unknown) => rewriteLocalMarkdownImages(tree);

export const CHAT_MARKDOWN_REMARK_PLUGINS = [
  ...Object.values(defaultRemarkPlugins),
  localImageRemarkPlugin,
];

export function classifyMarkdownImageSource(src: string | undefined): MarkdownImageSource {
  if (!src) return { type: "blocked" };
  if (src.startsWith(LOCAL_IMAGE_PREFIX)) {
    try {
      return {
        type: "session-file",
        destination: decodeURIComponent(src.slice(LOCAL_IMAGE_PREFIX.length)),
      };
    } catch {
      return { type: "blocked" };
    }
  }
  if (/^[a-z]:[\\/]/i.test(src) || src.startsWith(String.raw`\\`)) {
    return { type: "session-file", destination: src };
  }
  if (/^(?:https?:|blob:)/i.test(src) || RASTER_DATA_URL.test(src)) {
    return { type: "direct", url: src };
  }
  if (src.startsWith("~/") || src.startsWith("~\\") || src.startsWith("//")) {
    return { type: "blocked" };
  }
  if (/^file:/i.test(src)) return { type: "session-file", destination: src };
  if (EXPLICIT_SCHEME.test(src)) return { type: "blocked" };
  return { type: "session-file", destination: src };
}
