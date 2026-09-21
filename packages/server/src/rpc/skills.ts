import { skillsContract } from "@getpie/contract/skills";

import { SkillService } from "../skills";
import type { RpcContext } from "./context";
import { implement } from "./orpc";

const orpc = implement(skillsContract).$context<RpcContext>();

export const skillsRouter = orpc.router({
  list: orpc.list.effect(function* () {
    const skills = yield* SkillService;
    return yield* skills.list();
  }),
});

export type SkillsRouter = typeof skillsRouter;
