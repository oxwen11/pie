import type { AgentModel, SessionRef } from "@getpie/contract";
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

import { useSessionModels } from "@/features/chat/hooks/use-session-models";

type ModelOption = {
  provider: string;
  modelId: string;
  label: string;
};

type ModelGroup = {
  provider: string;
  items: ModelOption[];
};

function groupsFrom(models: ReadonlyArray<AgentModel>) {
  const options = models.map((model) => ({
    provider: model.provider,
    modelId: model.modelId,
    label: model.name ?? model.modelId,
  }));
  const byProvider = new Map<string, ModelOption[]>();
  for (const option of options) {
    const items = byProvider.get(option.provider) ?? [];
    items.push(option);
    byProvider.set(option.provider, items);
  }
  return { options, groups: [...byProvider].map(([provider, items]) => ({ items, provider })) };
}

export function ChatModelSelect({ sessionRef }: { sessionRef: SessionRef }) {
  const { models, providerId, modelId, isLoading, setModel, isSettingModel } =
    useSessionModels(sessionRef);
  const filter = useComboboxFilter();
  const { options, groups } = useMemo(() => groupsFrom(models), [models]);
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

  if (isLoading || isSettingModel || models.length === 0) return null;

  return (
    <ModelSelector
      autoHighlight
      filter={matchesQuery}
      items={groups}
      onValueChange={(option) => {
        if (option) setModel(option.provider, option.modelId);
      }}
      value={value}
    >
      <ModelSelectorTrigger
        className="data-placeholder:text-muted-foreground min-w-0"
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
