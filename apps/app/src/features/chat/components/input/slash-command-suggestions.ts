import type { AgentCommand } from "@getpie/contract";
import { PluginKey } from "@tiptap/pm/state";
import type { Editor, Range } from "@tiptap/react";

export const slashCommandPluginKey = new PluginKey("chatSlashCommands");

export type SlashCommandItem = {
  command: AgentCommand;
  title: string;
  description?: string;
  keywords: string[];
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

export function filterSlashCommandItems(
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

  // oxlint-disable-next-line unicorn/no-array-sort -- matched is a fresh array
  const ranked = normalizedQuery
    ? matched.sort((a, b) => {
        const aTitle = a.title.slice(1).toLowerCase();
        const bTitle = b.title.slice(1).toLowerCase();
        if (aTitle === normalizedQuery && bTitle !== normalizedQuery) return -1;
        if (bTitle === normalizedQuery && aTitle !== normalizedQuery) return 1;
        if (aTitle.startsWith(normalizedQuery) && !bTitle.startsWith(normalizedQuery)) return -1;
        if (bTitle.startsWith(normalizedQuery) && !aTitle.startsWith(normalizedQuery)) return 1;
        return 0;
      })
    : matched;

  return [
    ...ranked.filter((item) => item.command.source !== "skill"),
    ...ranked.filter((item) => item.command.source === "skill"),
  ];
}

export function insertSlashCommand(editor: Editor, range: Range, item: SlashCommandItem): void {
  editor.chain().focus().insertContentAt(range, `/${item.command.name} `).run();
}
