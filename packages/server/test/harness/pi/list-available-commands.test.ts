import assert from "node:assert/strict";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

import { listAvailablePiCommands } from "../../../src/harness/pi/list-available-commands";

const writeResources = (
  promptDirectory: string,
  skillRoot: string,
  promptName: string,
  skillName: string,
  scope = "",
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const skillDirectory = path.join(skillRoot, skillName);
    const qualifier = scope ? `${scope} ` : "";

    yield* fs.makeDirectory(promptDirectory, { recursive: true });
    yield* fs.makeDirectory(skillDirectory, { recursive: true });
    yield* fs.writeFileString(
      path.join(promptDirectory, `${promptName}.md`),
      `---\ndescription: ${qualifier}Run ${promptName}\n---\nRun $@`,
    );
    yield* fs.writeFileString(
      path.join(skillDirectory, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: ${qualifier}Use ${skillName}\n---\nUse the skill.`,
    );
  });

const writeProjectResources = (cwd: string, promptName: string, skillName: string, scope = "") =>
  writeResources(
    path.join(cwd, ".pi", "prompts"),
    path.join(cwd, ".agents", "skills"),
    promptName,
    skillName,
    scope,
  );

const writeGlobalResources = (
  agentDir: string,
  promptName: string,
  skillName: string,
  scope = "",
) =>
  writeResources(
    path.join(agentDir, "prompts"),
    path.join(agentDir, "skills"),
    promptName,
    skillName,
    scope,
  );

layer(NodeServices.layer)("listAvailablePiCommands", (it) => {
  it.effect("discovers project prompt commands and skills using Pi invocation names", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "pie-commands-" });
      yield* writeProjectResources(cwd, "explain", "review");

      const commands = yield* Effect.promise(() => listAvailablePiCommands(cwd));
      const explain = commands.find((command) => command.name === "explain");
      const review = commands.find((command) => command.name === "skill:review");

      assert.deepEqual(explain, {
        name: "explain",
        description: "Run explain",
        source: "prompt",
      });
      assert.deepEqual(review, {
        name: "skill:review",
        description: "Use review",
        source: "skill",
      });
      assert.ok(commands.indexOf(explain!) < commands.indexOf(review!));
      assert.equal("sourceInfo" in explain!, false);
    }),
  );

  it.effect("discovers global resources and lets Project resources override them", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const agentDir = yield* fs.makeTempDirectoryScoped({ prefix: "pie-agent-commands-" });
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "pie-project-commands-" });
      yield* writeGlobalResources(agentDir, "shared-prompt", "global-skill", "Global");

      const globalCommands = yield* Effect.promise(() =>
        listAvailablePiCommands(undefined, agentDir),
      );
      assert.deepEqual(
        globalCommands.find((command) => command.name === "shared-prompt"),
        {
          name: "shared-prompt",
          description: "Global Run shared-prompt",
          source: "prompt",
        },
      );
      assert.ok(globalCommands.some((command) => command.name === "skill:global-skill"));

      yield* writeProjectResources(cwd, "shared-prompt", "project-skill", "Project");
      const projectCommands = yield* Effect.promise(() => listAvailablePiCommands(cwd, agentDir));
      assert.deepEqual(
        projectCommands.filter((command) => command.name === "shared-prompt"),
        [
          {
            name: "shared-prompt",
            description: "Project Run shared-prompt",
            source: "prompt",
          },
        ],
      );
      assert.ok(projectCommands.some((command) => command.name === "skill:global-skill"));
      assert.ok(projectCommands.some((command) => command.name === "skill:project-skill"));
    }),
  );

  it.effect("uses skill dispatch precedence for invocation-name collisions", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const agentDir = yield* fs.makeTempDirectoryScoped({ prefix: "pie-agent-collision-" });
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "pie-command-collision-" });
      yield* writeProjectResources(cwd, "skill:review", "review");

      const commands = yield* Effect.promise(() => listAvailablePiCommands(cwd, agentDir));
      assert.deepEqual(
        commands.filter((command) => command.name === "skill:review"),
        [{ name: "skill:review", description: "Use review", source: "skill" }],
      );
    }),
  );

  it.effect("does not execute Project extensions during command discovery", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "pie-command-extension-" });
      const extensionDirectory = path.join(cwd, ".pi", "extensions");
      const marker = path.join(cwd, "extension-loaded");
      yield* fs.makeDirectory(extensionDirectory, { recursive: true });
      yield* fs.writeFileString(
        path.join(extensionDirectory, "marker.ts"),
        `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(marker)}, "loaded");\nexport default function markerExtension() {}\n`,
      );

      yield* Effect.promise(() => listAvailablePiCommands(cwd));
      assert.equal(yield* fs.exists(marker), false);
    }),
  );

  it.effect("keeps command discovery scoped to the requested Project", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const first = yield* fs.makeTempDirectoryScoped({ prefix: "pie-commands-a-" });
      const second = yield* fs.makeTempDirectoryScoped({ prefix: "pie-commands-b-" });
      yield* writeProjectResources(first, "first-prompt", "first-skill");
      yield* writeProjectResources(second, "second-prompt", "second-skill");

      const firstCommands = yield* Effect.promise(() => listAvailablePiCommands(first));
      const secondCommands = yield* Effect.promise(() => listAvailablePiCommands(second));

      assert.ok(firstCommands.some((command) => command.name === "first-prompt"));
      assert.ok(firstCommands.some((command) => command.name === "skill:first-skill"));
      assert.ok(!firstCommands.some((command) => command.name === "second-prompt"));
      assert.ok(secondCommands.some((command) => command.name === "second-prompt"));
      assert.ok(secondCommands.some((command) => command.name === "skill:second-skill"));
      assert.ok(!secondCommands.some((command) => command.name === "first-prompt"));
    }),
  );
});
