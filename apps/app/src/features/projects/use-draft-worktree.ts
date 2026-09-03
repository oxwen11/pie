import type { CreateWorktreeInput, Project } from "@getpie/contract";
import { isGitRepositoryBranch } from "@getpie/contract/git";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useState } from "react";

import type { DraftWorkspaceMode } from "./draft-workspace-select";
import { defaultWorktreeBase } from "./draft-worktree-base";

export function useDraftWorktree(selected: Project | null) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const projectId = selected?.id ?? null;
  const [draft, setDraft] = useState<{
    projectId: string | null;
    mode: DraftWorkspaceMode;
    baseOverride: string | null;
  }>({ projectId, mode: "project", baseOverride: null });

  if (draft.projectId !== projectId) {
    setDraft({ projectId, mode: "project", baseOverride: null });
  }

  const gitBranch = useQuery({
    ...orpcQueryUtils.git.branch.queryOptions({
      input: selected === null ? skipToken : { cwd: selected.path },
    }),
    // Repository availability is an explicit result; only unexpected failures reach error state.
    retry: false,
    refetchOnWindowFocus: false,
  });

  const branchData = gitBranch.data;
  const repositoryBranch = isGitRepositoryBranch(branchData) ? branchData : undefined;
  const gitAvailable = repositoryBranch !== undefined;
  const mode: DraftWorkspaceMode = gitAvailable ? draft.mode : "project";
  const worktreeBase =
    mode === "worktree" ? (draft.baseOverride ?? defaultWorktreeBase(repositoryBranch)) : null;
  const worktree: CreateWorktreeInput | undefined =
    mode === "worktree" && worktreeBase !== null ? { base: worktreeBase } : undefined;

  return {
    gitAvailable,
    gitBranch,
    gitState: branchData?.kind,
    repositoryBranch,
    mode,
    setMode: (next: DraftWorkspaceMode) => {
      setDraft((current) => ({
        ...current,
        mode: next,
        baseOverride: next === "project" ? null : current.baseOverride,
      }));
    },
    worktreeBase,
    setWorktreeBaseOverride: (value: string | null) => {
      setDraft((current) => ({ ...current, baseOverride: value }));
    },
    worktree,
  };
}
