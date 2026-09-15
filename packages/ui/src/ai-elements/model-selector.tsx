"use client";

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
import { cn } from "@getpie/ui/lib/utils";
import { SearchIcon } from "lucide-react";
import { type ComponentProps, useCallback, useMemo } from "react";

import { providerLogoSrc } from "./provider-logo";

/** Combobox-backed model picker. Same compound surface as AI Elements, without a dialog. */
export const ModelSelector = Combobox;

export type ModelSelectorTriggerProps = ComponentProps<typeof ComboboxTrigger>;

export const ModelSelectorTrigger = (props: ModelSelectorTriggerProps) => (
  <ComboboxTrigger data-slot="model-selector-trigger" {...props} />
);

export type ModelSelectorPopupProps = ComponentProps<typeof ComboboxPopup>;

export const ModelSelectorPopup = ({ className, ...props }: ModelSelectorPopupProps) => (
  <ComboboxPopup
    className={cn("min-w-64", className)}
    data-slot="model-selector-popup"
    {...props}
  />
);

export type ModelSelectorInputProps = ComponentProps<typeof ComboboxInput>;

export const ModelSelectorInput = (props: ModelSelectorInputProps) => (
  <ComboboxInput data-slot="model-selector-input" {...props} />
);

export type ModelSelectorListProps = ComponentProps<typeof ComboboxList>;

export const ModelSelectorList = (props: ModelSelectorListProps) => (
  <ComboboxList data-slot="model-selector-list" {...props} />
);

export type ModelSelectorEmptyProps = ComponentProps<typeof ComboboxEmpty>;

export const ModelSelectorEmpty = (props: ModelSelectorEmptyProps) => (
  <ComboboxEmpty data-slot="model-selector-empty" {...props} />
);

export type ModelSelectorGroupProps = ComponentProps<typeof ComboboxGroup>;

export const ModelSelectorGroup = (props: ModelSelectorGroupProps) => (
  <ComboboxGroup data-slot="model-selector-group" {...props} />
);

export type ModelSelectorGroupLabelProps = ComponentProps<typeof ComboboxGroupLabel>;

export const ModelSelectorGroupLabel = (props: ModelSelectorGroupLabelProps) => (
  <ComboboxGroupLabel data-slot="model-selector-group-label" {...props} />
);

export const ModelSelectorCollection = ComboboxCollection;

export const ModelSelectorValue = ComboboxValue;

export type ModelSelectorItemProps = ComponentProps<typeof ComboboxItem>;

export const ModelSelectorItem = ({ className, children, ...props }: ModelSelectorItemProps) => (
  <ComboboxItem
    className={cn(
      "data-selected:bg-accent data-selected:text-accent-foreground grid-cols-1 [&>:first-child]:hidden [&>:last-child]:col-start-1",
      className,
    )}
    data-slot="model-selector-item"
    {...props}
  >
    <span className="flex min-w-0 items-center gap-2">{children}</span>
  </ComboboxItem>
);

export type ModelSelectorLogoProps = Omit<ComponentProps<"img">, "src" | "alt"> & {
  provider: string;
};

export const ModelSelectorLogo = ({ provider, className, ...props }: ModelSelectorLogoProps) => {
  const src = providerLogoSrc(provider);
  if (src === undefined) {
    return (
      <span
        aria-hidden
        className={cn(
          "bg-muted text-muted-foreground flex size-3 shrink-0 items-center justify-center rounded-[2px] text-[8px] font-medium uppercase",
          className,
        )}
        data-slot="model-selector-logo"
      >
        {provider.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      alt={`${provider} logo`}
      className={cn("size-3 shrink-0 dark:invert", className)}
      data-slot="model-selector-logo"
      height={12}
      src={src}
      width={12}
      {...props}
    />
  );
};

export type ModelSelectorLogoGroupProps = ComponentProps<"div">;

export const ModelSelectorLogoGroup = ({ className, ...props }: ModelSelectorLogoGroupProps) => (
  <div
    className={cn(
      "[&>img]:bg-background dark:[&>img]:bg-foreground flex shrink-0 items-center -space-x-1 [&>img]:rounded-full [&>img]:p-px [&>img]:ring-1",
      className,
    )}
    data-slot="model-selector-logo-group"
    {...props}
  />
);

export type ModelSelectorNameProps = ComponentProps<"span">;

export const ModelSelectorName = ({ className, ...props }: ModelSelectorNameProps) => (
  <span
    className={cn("min-w-0 flex-1 truncate text-left", className)}
    data-slot="model-selector-name"
    {...props}
  />
);

export type ModelSelectorOption = {
  provider: string;
  modelId: string;
  label: string;
};

type ModelSelectorGroupItems = {
  provider: string;
  items: ModelSelectorOption[];
};

export type ModelSelectorPickerProps = {
  models: ReadonlyArray<{ provider: string; modelId: string; name?: string }>;
  providerId: string | undefined;
  modelId: string | undefined;
  onChange: (provider: string, modelId: string) => void;
  "aria-label"?: string;
};

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
    const byProvider = new Map<string, ModelSelectorOption[]>();
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
    (option: ModelSelectorOption, query: string) =>
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
        aria-label={ariaLabel}
        className="data-placeholder:text-muted-foreground hover:bg-accent min-w-0 transition-colors"
        render={<Button aria-label={ariaLabel} size="sm" variant="ghost" />}
      >
        <ModelSelectorValue placeholder="Default">
          {(option: ModelSelectorOption | null) => (
            <ModelSelectorName>{option?.label ?? "Default"}</ModelSelectorName>
          )}
        </ModelSelectorValue>
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
            {(group: ModelSelectorGroupItems) => (
              <ModelSelectorGroup items={group.items} key={group.provider}>
                <ModelSelectorGroupLabel>{group.provider}</ModelSelectorGroupLabel>
                <ModelSelectorCollection>
                  {(option: ModelSelectorOption) => (
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
