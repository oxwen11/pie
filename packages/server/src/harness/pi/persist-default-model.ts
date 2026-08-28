import { SettingsManager } from "@earendil-works/pi-coding-agent";

/**
 * Write Pi's global startup default (`defaultProvider` / `defaultModel` in
 * `~/.pi/agent/settings.json`). Same store {@link resolveDefaultPiModel} reads.
 *
 * Live RPC `set_model` only runs once a session has a child, and newer Pi
 * treats it as session-local unless `persist: true` (which the RPC command
 * does not pass). Draft and never-opened sessions have no child. The UI
 * therefore writes this store itself whenever the user picks a model.
 */
export function persistDefaultPiModel(
  cwd: string,
  model: { readonly provider: string; readonly modelId: string },
): void {
  SettingsManager.create(cwd).setDefaultModelAndProvider(model.provider, model.modelId);
}
