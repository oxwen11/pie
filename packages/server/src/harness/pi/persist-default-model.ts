import { SettingsManager } from "@earendil-works/pi-coding-agent";

/**
 * Write Pi's global startup default (`defaultProvider` / `defaultModel` in
 * `~/.pi/agent/settings.json`). Same store `resolveDefaultPiModel` reads.
 *
 * Live RPC `set_model` only runs once a session has a child, and newer Pi
 * treats it as session-local unless `persist: true` (which the RPC command
 * does not pass). Draft and never-opened sessions have no child. The UI
 * therefore writes this store itself whenever the user picks a model.
 *
 * `SettingsManager.save` enqueues the disk write — `flush` waits for it.
 */
export async function persistDefaultPiModel(
  cwd: string,
  model: { readonly provider: string; readonly modelId: string },
): Promise<void> {
  const settings = SettingsManager.create(cwd);
  settings.setDefaultModelAndProvider(model.provider, model.modelId);
  await settings.flush();
  const [failed] = settings.drainErrors();
  if (failed) throw failed.error;
}
