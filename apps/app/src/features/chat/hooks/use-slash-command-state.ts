import { useCallback, useMemo } from "react";

import type { SlashCommandState } from "@/features/chat/components/input/slash-command-suggestions";
import { createSlashCommandSuggestionItems } from "@/features/chat/components/input/slash-command-suggestions";

import { useAgentCommands } from "./use-agent-commands";

export function useSlashCommandState(projectId: string | undefined): SlashCommandState {
  const commands = useAgentCommands(projectId);
  const { refetch } = commands;
  const retry = useCallback(() => void refetch(), [refetch]);

  return useMemo(() => {
    if (commands.isPending) return { status: "loading" };
    if (commands.isError) {
      return {
        status: "error",
        message: commands.error.message,
        retry,
      };
    }
    return {
      status: "ready",
      items: createSlashCommandSuggestionItems(commands.data),
    };
  }, [commands.data, commands.error, commands.isError, commands.isPending, retry]);
}
