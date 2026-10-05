export type TextRange = { start: number; end: number };

export type SkillMatch = {
  field: "name" | "description";
  ranges: TextRange[];
};

type NormChar = { index: number; char: string };
type FieldMatch = { score: number; ranges: TextRange[] };

const NAME_TIER = 0;
const DESCRIPTION_TIER = 5;
// Keeps a name tier ahead of the next tier after position and length penalties.
const TIER_GAP = 256;

function isSeparator(char: string): boolean {
  return char === "-" || char === "_" || char === "/" || /\s/u.test(char);
}

/** Length-preserving fold. `İ`.toLowerCase() is two units and would shift later ranges. */
function foldUnit(unit: string): string {
  const lower = unit.toLowerCase();
  return lower.length === 1 ? lower : (lower[0] ?? unit);
}

function normalizeChars(value: string): NormChar[] {
  const chars: NormChar[] = [];
  let index = 0;
  while (index < value.length) {
    const char = value[index] ?? "";
    if (!isSeparator(char)) {
      chars.push({ index, char: foldUnit(char) });
      index += 1;
      continue;
    }
    while (index < value.length && isSeparator(value[index] ?? "")) index += 1;
    if (chars.length > 0 && index < value.length) chars.push({ index: -1, char: " " });
  }
  return chars;
}

function normalized(value: string): string {
  return normalizeChars(value)
    .map((char) => char.char)
    .join("");
}

function mergeRanges(ranges: readonly TextRange[]): TextRange[] {
  const merged: TextRange[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && last.end === range.start) last.end = range.end;
    else merged.push({ ...range });
  }
  return merged;
}

function rangesFor(chars: readonly NormChar[], start: number, end: number): TextRange[] {
  return mergeRanges(
    chars
      .slice(start, end)
      .flatMap((char) => (char.index < 0 ? [] : [{ start: char.index, end: char.index + 1 }])),
  );
}

function subsequenceIndexes(value: string, query: string): number[] | null {
  const indexes: number[] = [];
  let queryIndex = 0;
  for (let valueIndex = 0; valueIndex < value.length; valueIndex += 1) {
    if (value[valueIndex] !== query[queryIndex]) continue;
    indexes.push(valueIndex);
    queryIndex += 1;
    if (queryIndex === query.length) return indexes;
  }
  return null;
}

function penalty(start: number, valueLength: number, queryLength: number): number {
  return Math.min(64, start * 2) + Math.min(64, Math.max(0, valueLength - queryLength));
}

function tierScore(offset: number, tier: number, extra: number): number {
  return (offset + tier) * TIER_GAP + extra;
}

function matchField(
  value: string,
  query: string,
  offset: number,
  fuzzy: boolean,
): FieldMatch | null {
  const chars = normalizeChars(value);
  const text = chars.map((char) => char.char).join("");
  if (text.length === 0 || query.length === 0) return null;

  if (text === query) {
    return { score: tierScore(offset, 0, 0), ranges: rangesFor(chars, 0, chars.length) };
  }
  if (text.startsWith(query)) {
    return {
      score: tierScore(offset, 1, penalty(0, text.length, query.length)),
      ranges: rangesFor(chars, 0, query.length),
    };
  }
  const boundary = text.indexOf(` ${query}`);
  if (boundary !== -1) {
    const start = boundary + 1;
    return {
      score: tierScore(offset, 2, penalty(start, text.length, query.length)),
      ranges: rangesFor(chars, start, start + query.length),
    };
  }
  const includes = text.indexOf(query);
  if (includes !== -1) {
    return {
      score: tierScore(offset, 3, penalty(includes, text.length, query.length)),
      ranges: rangesFor(chars, includes, includes + query.length),
    };
  }
  if (!fuzzy) return null;

  const indexes = subsequenceIndexes(text, query);
  if (!indexes) return null;
  const first = indexes[0] ?? 0;
  const last = indexes.at(-1) ?? first;
  let gap = 0;
  for (let index = 1; index < indexes.length; index += 1) {
    gap += (indexes[index] ?? 0) - (indexes[index - 1] ?? 0) - 1;
  }
  const fuzzyPenalty =
    first * 2 +
    gap * 3 +
    (last - first + 1 - indexes.length) +
    Math.min(64, text.length - query.length);
  return {
    score: tierScore(offset, 4, fuzzyPenalty),
    ranges: rangesFor(
      indexes.flatMap((index) => {
        const char = chars[index];
        return char ? [char] : [];
      }),
      0,
      indexes.length,
    ),
  };
}

function bestMatch(
  name: string,
  description: string,
  query: string,
): (SkillMatch & { score: number }) | null {
  const needle = normalized(query);
  if (needle.length === 0) return null;
  const nameMatch = matchField(name, needle, NAME_TIER, true);
  const descriptionMatch = matchField(description, needle, DESCRIPTION_TIER, false);
  if (nameMatch && (!descriptionMatch || nameMatch.score <= descriptionMatch.score)) {
    return { field: "name", ranges: nameMatch.ranges, score: nameMatch.score };
  }
  if (descriptionMatch) {
    return { field: "description", ranges: descriptionMatch.ranges, score: descriptionMatch.score };
  }
  return null;
}

export function searchSkills<T extends { name: string; description: string }>(
  items: readonly T[],
  query: string,
): Array<T & { match: SkillMatch | null }> {
  if (normalized(query).length === 0) return items.map((item) => ({ ...item, match: null }));

  return items
    .map((item, index) => ({ item, index, match: bestMatch(item.name, item.description, query) }))
    .filter(
      (entry): entry is typeof entry & { match: SkillMatch & { score: number } } =>
        entry.match !== null,
    )
    .sort(
      (left, right) =>
        left.match.score - right.match.score ||
        left.item.name.localeCompare(right.item.name) ||
        left.index - right.index,
    )
    .map(({ item, match }) => ({ ...item, match: { field: match.field, ranges: match.ranges } }));
}
