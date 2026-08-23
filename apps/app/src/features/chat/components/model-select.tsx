import type { AgentModel } from "@getpie/contract";
import {
  PromptInputModelSelect,
  PromptInputModelSelectContent,
  PromptInputModelSelectItem,
  PromptInputModelSelectTrigger,
  PromptInputModelSelectValue,
} from "@getpie/ui/ai-elements/prompt-input";

// Presentational model picker: value/onChange driven so it composes inside a
// live session. Options come from Pi's `get_available_models` — never hardcoded.
// Model ids are scoped to their provider; the pair always travels together.
export function ModelSelect({
  models,
  providerId,
  modelId,
  onChange,
}: {
  models: ReadonlyArray<AgentModel>;
  providerId: string | undefined;
  modelId: string | undefined;
  onChange: (providerId: string, modelId: string) => void;
}) {
  if (models.length === 0) return null;

  const providers = [...new Set(models.map((model) => model.provider))];
  const showProvider = providers.length > 1;
  const options = models.map((model) => ({
    providerId: model.provider,
    modelId: model.modelId,
    label: showProvider
      ? `${model.provider} · ${model.name ?? model.modelId}`
      : (model.name ?? model.modelId),
  }));

  const selectedIndex = options.findIndex(
    (option) => option.providerId === providerId && option.modelId === modelId,
  );
  const items = options.map((option, index) => ({ label: option.label, value: String(index) }));

  return (
    <PromptInputModelSelect
      items={items}
      value={selectedIndex >= 0 ? String(selectedIndex) : null}
      onValueChange={(next) => {
        const option = next === null ? undefined : options[Number(next)];
        if (option) onChange(option.providerId, option.modelId);
      }}
    >
      <PromptInputModelSelectTrigger className="min-h-8 py-0">
        <PromptInputModelSelectValue placeholder="Default" />
      </PromptInputModelSelectTrigger>
      <PromptInputModelSelectContent>
        {items.map((item) => (
          <PromptInputModelSelectItem key={item.value} value={item.value}>
            {item.label}
          </PromptInputModelSelectItem>
        ))}
      </PromptInputModelSelectContent>
    </PromptInputModelSelect>
  );
}
