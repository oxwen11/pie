import { SettingsManager } from "@earendil-works/pi-coding-agent";

/** Write Pi's global default provider/model so the next draft/listModels picks it up. */
export async function persistDefaultPiModel(provider: string, modelId: string): Promise<void> {
  const settings = SettingsManager.create(process.cwd());
  settings.setDefaultModelAndProvider(provider, modelId);
  // save() only enqueues; flush waits for the writeFile.
  await settings.flush();
}
