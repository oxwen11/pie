import type { AgentCommand } from "@getpie/contract";
import { PluginKey } from "@tiptap/pm/state";
import type { Editor, Range } from "@tiptap/react";

import { searchSkills, type SkillMatch } from "@/lib/skill-search";

export const slashCommandPluginKey = new PluginKey("chatSlashCommands");

export type SlashCommandItem = {
  command: AgentCommand;
  title: string;
  description?: string;
  keywords: string[];
  match?: SkillMatch | null;
};

export type SlashCommandState =
  | { status: "loading" }
  | { status: "ready"; items: SlashCommandItem[] }
  | { status: "error"; message: string; retry: () => void };

/** Pi only expands slash input when the slash begins the complete prompt. */
export function allowSlashCommandSuggestion({ range }: { range: Range }): boolean {
  return range.from === 1;
}

export function slashCommandLabel(command: AgentCommand): string {
  return command.source === "skill" ? command.name.replace(/^skill:/, "") : command.name;
}

export function createSlashCommandSuggestionItems(
  commands: ReadonlyArray<AgentCommand>,
): SlashCommandItem[] {
  return commands.map((command) => ({
    command,
    title: `/${command.name}`,
    description: command.description,
    keywords: [command.name, command.source, command.source === "skill" ? "skill" : "command"],
  }));
}

function rankCommandItems(
  items: ReadonlyArray<SlashCommandItem>,
  query: string,
): SlashCommandItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const matched = normalizedQuery
    ? items.filter(
        (item) =>
          item.title.toLowerCase().includes(normalizedQuery) ||
          (item.description?.toLowerCase().includes(normalizedQuery) ?? false) ||
          item.keywords.some((keyword) => keyword.toLowerCase().includes(normalizedQuery)),
      )
    : [...items];
  if (!normalizedQuery) return matched;

  // oxlint-disable-next-line unicorn/no-array-sort -- matched is a fresh array
  return matched.sort((left, right) => {
    const leftTitle = left.title.slice(1).toLowerCase();
    const rightTitle = right.title.slice(1).toLowerCase();
    if (leftTitle === normalizedQuery && rightTitle !== normalizedQuery) return -1;
    if (rightTitle === normalizedQuery && leftTitle !== normalizedQuery) return 1;
    if (leftTitle.startsWith(normalizedQuery) && !rightTitle.startsWith(normalizedQuery)) return -1;
    if (rightTitle.startsWith(normalizedQuery) && !leftTitle.startsWith(normalizedQuery)) return 1;
    return 0;
  });
}

function skillSearchQuery(query: string): string {
  return query.trim().replace(/^skill:/i, "");
}

export function filterSlashCommandItems(
  items: ReadonlyArray<SlashCommandItem>,
  query: string,
): SlashCommandItem[] {
  const commands = items.filter((item) => item.command.source !== "skill");
  const skills = items.filter((item) => item.command.source === "skill");
  const rankedSkills = searchSkills(
    skills.map((item) => ({
      item,
      name: slashCommandLabel(item.command),
      description: item.description ?? "",
    })),
    skillSearchQuery(query),
  ).map((hit) => ({ ...hit.item, match: hit.match }));

  return [...rankCommandItems(commands, query), ...rankedSkills];
}

export function insertSlashCommand(editor: Editor, range: Range, item: SlashCommandItem): void {
  editor.chain().focus().insertContentAt(range, `/${item.command.name} `).run();
}
