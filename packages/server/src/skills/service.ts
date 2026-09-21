import { getAgentDir, loadSkills } from "@earendil-works/pi-coding-agent";
import type { SkillItem } from "@getpie/contract/skills";
import { Context, Effect, Layer } from "effect";

export type SkillServiceShape = {
  readonly list: () => Effect.Effect<ReadonlyArray<SkillItem>>;
};

export class SkillService extends Context.Service<SkillService, SkillServiceShape>()(
  "SkillService",
) {}

/** User/global skills only — same discovery Pi uses at session start. */
export function makeSkillService(agentDir: () => string = getAgentDir): SkillServiceShape {
  return {
    list: () =>
      Effect.sync(() => {
        const dir = agentDir();
        const { skills } = loadSkills({
          cwd: dir,
          agentDir: dir,
          skillPaths: [],
          includeDefaults: true,
        });
        return skills
          .filter((skill) => skill.sourceInfo.scope === "user")
          .map(
            (skill): SkillItem => ({
              name: skill.name,
              description: skill.description,
              path: skill.filePath,
              source: skill.sourceInfo.source,
              scope: skill.sourceInfo.scope,
            }),
          );
      }),
  };
}

export const SkillServiceLayer: Layer.Layer<SkillService> = Layer.succeed(
  SkillService,
  makeSkillService(),
);
