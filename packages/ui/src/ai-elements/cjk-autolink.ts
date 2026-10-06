// GFM autolink literals only treat ASCII punctuation as a trail, so a Chinese
// sentence mark is swallowed into the href (`…/453。`).
const CJK_AUTOLINK_PUNCTUATION = new Set("。．，、？！：；（）【】「」『』〈〉《》");

type MdastNode = {
  type?: string;
  url?: string;
  value?: string;
  children?: MdastNode[];
};

function cjkPunctuationIndex(value: string): number | null {
  let index = 0;
  for (const char of value) {
    if (CJK_AUTOLINK_PUNCTUATION.has(char)) return index;
    index += char.length;
  }
  return null;
}

function isAutolinkLiteral(url: string, text: string): boolean {
  return text === url || url === `http://${text}` || url === `mailto:${text}`;
}

function peelAutolink(node: MdastNode): string | null {
  if (node.type !== "link" || typeof node.url !== "string") return null;
  const [only, ...rest] = node.children ?? [];
  if (rest.length > 0 || only?.type !== "text" || typeof only.value !== "string") return null;
  if (!isAutolinkLiteral(node.url, only.value)) return null;

  const splitAt = cjkPunctuationIndex(only.value);
  if (splitAt === null || splitAt === 0) return null;
  const trail = only.value.slice(splitAt);
  if (!node.url.endsWith(trail)) return null;

  const url = node.url.slice(0, -trail.length);
  const text = only.value.slice(0, splitAt);
  if (!url || !text) return null;
  node.url = url;
  node.children = [{ type: "text", value: text }];
  return trail;
}

function peel(node: MdastNode): void {
  const children = node.children;
  if (!children) return;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!child) continue;
    const trail = peelAutolink(child);
    if (trail) {
      // ponytail: a second URL jammed against this punctuation stays text.
      children.splice(index + 1, 0, { type: "text", value: trail });
      index += 1;
      continue;
    }
    peel(child);
  }
}

export function peelCjkAutolinkPunctuation() {
  return (tree: unknown) => {
    if (typeof tree === "object" && tree !== null) peel(tree);
  };
}
