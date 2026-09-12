import type { Project } from "@getpie/contract";

export function projectNameOf(
  projects: ReadonlyArray<Pick<Project, "id" | "name">>,
  projectId: string,
): string {
  return projects.find((item) => item.id === projectId)?.name ?? "Unknown project";
}
