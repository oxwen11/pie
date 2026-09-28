import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { FileUIPart } from "ai";

const RASTER_IMAGE_MEDIA_TYPES = new Set([
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Adapt Pi tool content to AI SDK tool output plus first-class file parts. */
export function adaptPiToolResult<T>(result: AgentToolResult<T>) {
  const content: AgentToolResult<T>["content"] = [];
  const files: FileUIPart[] = [];

  for (const block of result.content) {
    switch (block.type) {
      case "text":
        content.push(block);
        break;
      case "image":
        if (RASTER_IMAGE_MEDIA_TYPES.has(block.mimeType)) {
          files.push({
            type: "file",
            mediaType: block.mimeType,
            url: `data:${block.mimeType};base64,${block.data}`,
          });
        }
        break;
      default:
        void (block satisfies never);
    }
  }

  return { output: { ...result, content }, files };
}
