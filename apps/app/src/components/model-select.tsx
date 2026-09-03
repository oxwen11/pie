import type { AgentModel } from "@getpie/contract";
import {
  ModelSelector,
  ModelSelectorCollection,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorGroupLabel,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorPopup,
  ModelSelectorTrigger,
  ModelSelectorValue,
} from "@getpie/ui/ai-elements/model-selector";
import { Button } from "@getpie/ui/components/button";
import { useComboboxFilter } from "@getpie/ui/components/combobox";
import { ChevronsUpDownIcon, SearchIcon } from "lucide-react";
import { useCallback, useMemo } from "react";

interface ModelOption {
  provider: string;
  modelId: string;
  label: string;
}

interface ModelGroup {
  provider: string;
  items: ModelOption[];
}

// Product composition of the compound ModelSelector. Options come from Pi's
// get_available_models — never hardcoded. The provider+modelId pair travels together.
export function ModelSelect({
  models,
  providerId,
  modelId,
  onChange,
  id,
}: {
  models: ReadonlyArray<AgentModel>;
  providerId: string | undefined;
  modelId: string | undefined;
  onChange: (providerId: string, modelId: string) => void;
  id?: string;
}) {
  const filter = useComboboxFilter();

  const options = useMemo<ModelOption[]>(
    () =>
      models.map((model) => ({
        provider: model.provider,
        modelId: model.modelId,
        label: model.name ?? model.modelId,
      })),
    [models],
  );

  const groups = useMemo<ModelGroup[]>(() => {
    const byProvider = new Map<string, ModelOption[]>();
    for (const option of options) {
      const groupItems = byProvider.get(option.provider) ?? [];
      groupItems.push(option);
      byProvider.set(option.provider, groupItems);
    }
    return [...byProvider].map(([provider, items]) => ({ items, provider }));
  }, [options]);

  const value = useMemo(
    () =>
      options.find((option) => option.provider === providerId && option.modelId === modelId) ??
      null,
    [options, providerId, modelId],
  );

  const matchesQuery = useCallback(
    (option: ModelOption, query: string) =>
      filter.contains(option.label, query) ||
      filter.contains(option.modelId, query) ||
      filter.contains(option.provider, query),
    [filter],
  );

  if (models.length === 0) return null;

  return (
    <ModelSelector
      autoHighlight
      filter={matchesQuery}
      items={groups}
      onValueChange={(option) => {
        if (option) onChange(option.provider, option.modelId);
      }}
      value={value}
    >
      <ModelSelectorTrigger
        className="data-placeholder:text-muted-foreground min-w-0"
        id={id}
        render={<Button size="sm" variant="ghost" />}
      >
        <ModelSelectorValue placeholder="Default">
          {(option: ModelOption | null) => (
            <span className="flex min-w-0 items-center gap-2">
              {option ? (
                <>
                  <ModelSelectorLogo provider={option.provider} />
                  <ModelSelectorName>{option.label}</ModelSelectorName>
                </>
              ) : (
                <ModelSelectorName>Default</ModelSelectorName>
              )}
            </span>
          )}
        </ModelSelectorValue>
        <ChevronsUpDownIcon />
      </ModelSelectorTrigger>
      <ModelSelectorPopup>
        <div className="border-b px-2 py-1.5">
          <ModelSelectorInput
            autoFocus
            className="border-transparent! bg-transparent! shadow-none before:hidden has-focus-visible:ring-0"
            placeholder="Search models…"
            showTrigger={false}
            size="sm"
            startAddon={<SearchIcon />}
          />
        </div>
        <ModelSelectorEmpty className="text-muted-foreground text-center text-sm">
          No matching models.
        </ModelSelectorEmpty>
        <div className="min-h-0 flex-1">
          <ModelSelectorList>
            {(group: ModelGroup) => (
              <ModelSelectorGroup items={group.items} key={group.provider}>
                <ModelSelectorGroupLabel>{group.provider}</ModelSelectorGroupLabel>
                <ModelSelectorCollection>
                  {(option: ModelOption) => (
                    <ModelSelectorItem key={`${option.provider}:${option.modelId}`} value={option}>
                      <ModelSelectorLogo provider={option.provider} />
                      <ModelSelectorName>{option.label}</ModelSelectorName>
                    </ModelSelectorItem>
                  )}
                </ModelSelectorCollection>
              </ModelSelectorGroup>
            )}
          </ModelSelectorList>
        </div>
      </ModelSelectorPopup>
    </ModelSelector>
  );
}
