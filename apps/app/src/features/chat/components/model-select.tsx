import type { AgentModel } from "@getpie/contract";
import { Button } from "@getpie/ui/components/button";
import {
  Combobox,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxFilter,
} from "@getpie/ui/components/combobox";
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

// Presentational model picker: value/onChange driven so it composes inside a
// live session. Options come from Pi's `get_available_models` — never hardcoded.
// Model ids are scoped to their provider; the pair always travels together.
// Models are grouped by provider and the popup filters as you type.
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

  // Search matches the display name, the raw model id, and the provider group.
  const matchesQuery = useCallback(
    (option: ModelOption, query: string) =>
      filter.contains(option.label, query) ||
      filter.contains(option.modelId, query) ||
      filter.contains(option.provider, query),
    [filter],
  );

  if (models.length === 0) return null;

  return (
    <Combobox
      autoHighlight
      filter={matchesQuery}
      items={groups}
      onValueChange={(option) => {
        if (option) onChange(option.provider, option.modelId);
      }}
      value={value}
    >
      <ComboboxTrigger
        className="data-placeholder:text-muted-foreground min-w-0"
        render={<Button size="sm" variant="ghost" />}
      >
        <ComboboxValue placeholder="Default">
          {(option: ModelOption | null) => (
            <span className="truncate">{option ? option.label : "Default"}</span>
          )}
        </ComboboxValue>
        <ChevronsUpDownIcon />
      </ComboboxTrigger>
      <ComboboxPopup className="min-w-64">
        <div className="border-b px-2 py-1.5">
          <ComboboxInput
            autoFocus
            className="border-transparent! bg-transparent! shadow-none before:hidden has-focus-visible:ring-0"
            placeholder="Search models…"
            showTrigger={false}
            size="sm"
            startAddon={<SearchIcon />}
          />
        </div>
        <ComboboxEmpty className="text-muted-foreground text-center text-sm not-empty:px-3 not-empty:py-6">
          No matching models.
        </ComboboxEmpty>
        <div className="min-h-0 flex-1">
          <ComboboxList>
            {(group: ModelGroup) => (
              <ComboboxGroup items={group.items} key={group.provider}>
                <ComboboxGroupLabel>{group.provider}</ComboboxGroupLabel>
                <ComboboxCollection>
                  {(option: ModelOption) => (
                    <ComboboxItem key={`${option.provider}:${option.modelId}`} value={option}>
                      {option.label}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </div>
      </ComboboxPopup>
    </Combobox>
  );
}
