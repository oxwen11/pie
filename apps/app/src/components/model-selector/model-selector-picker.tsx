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
import { SearchIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

type ModelOption = {
  provider: string;
  modelId: string;
  label: string;
};

type ModelGroup = {
  provider: string;
  items: ModelOption[];
};

export type ModelSelectorPickerProps = {
  models: ReadonlyArray<{ provider: string; modelId: string; name?: string }>;
  providerId: string | undefined;
  modelId: string | undefined;
  onChange: (provider: string, modelId: string) => void;
  "aria-label"?: string;
};

function ProviderLogo({ provider }: { provider: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        aria-hidden
        className="bg-muted text-muted-foreground flex size-3 shrink-0 items-center justify-center rounded-xs text-xs font-medium uppercase"
      >
        {provider.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      alt=""
      aria-hidden
      className="size-3 shrink-0 dark:invert"
      height={12}
      onError={() => setFailed(true)}
      src={`https://models.dev/logos/${encodeURIComponent(provider)}.svg`}
      width={12}
    />
  );
}

export function ModelSelectorPicker({
  models,
  providerId,
  modelId,
  onChange,
  "aria-label": ariaLabel,
}: ModelSelectorPickerProps) {
  const filter = useComboboxFilter();
  const options = useMemo(
    () =>
      models.map((model) => ({
        provider: model.provider,
        modelId: model.modelId,
        label: model.name ?? model.modelId,
      })),
    [models],
  );
  const groups = useMemo(() => {
    const byProvider = new Map<string, ModelOption[]>();
    for (const option of options) {
      const items = byProvider.get(option.provider) ?? [];
      items.push(option);
      byProvider.set(option.provider, items);
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
        aria-label={ariaLabel}
        className="data-placeholder:text-muted-foreground hover:bg-accent min-w-0"
        data-slot="model-selector-trigger"
        render={<Button size="sm" variant="ghost" />}
      >
        <ComboboxValue placeholder="Default">
          {(option: ModelOption | null) => (
            <span className="min-w-0 flex-1 truncate text-left">{option?.label ?? "Default"}</span>
          )}
        </ComboboxValue>
      </ComboboxTrigger>
      <ComboboxPopup className="min-w-64">
        <div className="border-b p-2">
          <ComboboxInput
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- focus search when the picker opens
            autoFocus
            className="rounded-md"
            placeholder="Search models…"
            showTrigger={false}
            startAddon={<SearchIcon />}
          />
        </div>
        <ComboboxEmpty>No matching models.</ComboboxEmpty>
        <ComboboxList>
          {(group: ModelGroup) => (
            <ComboboxGroup items={group.items} key={group.provider}>
              <ComboboxGroupLabel>{group.provider}</ComboboxGroupLabel>
              <ComboboxCollection>
                {(option: ModelOption) => (
                  <ComboboxItem key={`${option.provider}:${option.modelId}`} value={option}>
                    <span className="flex min-w-0 items-center gap-2">
                      <ProviderLogo provider={option.provider} />
                      <span className="min-w-0 flex-1 truncate text-left">{option.label}</span>
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
