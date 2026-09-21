import type { Editor, JSONContent } from "@tiptap/react";

export type ChatNodeTextSerializer = (node: JSONContent) => string;

// Serialization travels with the extension: a chip extension declares
// serializeText in addStorage(), collected here by extension name.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isChatNodeTextSerializer(value: unknown): value is ChatNodeTextSerializer {
  return typeof value === "function";
}

export function getChatText(editor: Editor): string {
  const serializers: Record<string, ChatNodeTextSerializer> = {};
  const storageBag: unknown = editor.storage;
  for (const extension of editor.extensionManager.extensions) {
    if (!isRecord(storageBag)) break;
    const storage = storageBag[extension.name];
    if (isRecord(storage) && isChatNodeTextSerializer(storage.serializeText)) {
      serializers[extension.name] = storage.serializeText;
    }
  }
  return serializeDoc(editor.getJSON(), serializers).trim();
}

// Matches ChatInputController.submit()'s send threshold: content counts only if
// there is submittable text after trim. Uses getChatText (not editor.getText)
// so chip-only documents (@mention / attachment) still count as content.
export function hasChatContent(editor: Editor): boolean {
  return getChatText(editor).trim().length > 0;
}

export function serializeDoc(
  doc: JSONContent,
  serializers: Record<string, ChatNodeTextSerializer>,
): string {
  const parts: string[] = [];
  const visit = (node: JSONContent) => {
    const custom = node.type ? serializers[node.type] : undefined;
    if (custom) {
      parts.push(custom(node));
      return;
    }
    if (node.type === "text") {
      const linkMark = node.marks?.find((mark) => mark.type === "link");
      const linkAttrs = linkMark?.attrs;
      const linkHref = isRecord(linkAttrs) ? linkAttrs.href : undefined;
      parts.push(
        typeof linkHref === "string" ? linkHref : (node.text ?? "").replaceAll("\u00A0", " "),
      );
      return;
    }
    if (node.type === "hardBreak") {
      parts.push("\n");
      return;
    }
    if (node.type === "codeBlock") {
      const body = (node.content ?? []).map((child) => child.text ?? "").join("");
      parts.push(`\`\`\`\n${body}\n\`\`\``);
      return;
    }
    for (const child of node.content ?? []) visit(child);
    if (node.type === "paragraph") {
      parts.push("\n");
    }
  };
  for (const child of doc.content ?? []) visit(child);
  return parts.join("");
}
