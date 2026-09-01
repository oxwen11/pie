import {
  DefaultResourceLoader,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentCommand } from "@getpie/contract";

import { PI_PROJECT_LOADER_OPTIONS, PI_PROJECT_SETTINGS_OPTIONS } from "./project-resource-policy";

/**
 * Cold command discovery from Pi's own resource loader. Without a Project,
 * the agent directory is also used as a neutral cwd so only global resources
 * are returned; a Project cwd overlays its prompts and skills.
 *
 * Prompt templates and skills expand into ordinary model turns, so Pie can
 * safely offer them in both draft and live-session inputs. Extension commands
 * are intentionally excluded: Pi permits them to complete without starting a
 * turn, while Pie's prompt lifecycle currently requires an accepted prompt to
 * start or steer one. The cold loader therefore disables extensions entirely;
 * discovering input shortcuts never executes Project extension code.
 */
export async function listAvailablePiCommands(
  cwd?: string,
  agentDir = getAgentDir(),
): Promise<AgentCommand[]> {
  const effectiveCwd = cwd ?? agentDir;
  const settingsManager = SettingsManager.create(
    effectiveCwd,
    agentDir,
    PI_PROJECT_SETTINGS_OPTIONS,
  );
  const resourceLoader = new DefaultResourceLoader({
    cwd: effectiveCwd,
    agentDir,
    settingsManager,
    ...PI_PROJECT_LOADER_OPTIONS,
  });
  await resourceLoader.reload();

  const commands = new Map<string, AgentCommand>();

  for (const prompt of resourceLoader.getPrompts().prompts) {
    commands.set(prompt.name, {
      name: prompt.name,
      description: prompt.description,
      source: "prompt",
    });
  }
  // Pi dispatches `skill:*` before prompt-template expansion, so skills replace
  // an identically named prompt instead of exposing an option Pi cannot invoke.
  for (const skill of resourceLoader.getSkills().skills) {
    const name = `skill:${skill.name}`;
    commands.set(name, { name, description: skill.description, source: "skill" });
  }

  return [...commands.values()];
}
