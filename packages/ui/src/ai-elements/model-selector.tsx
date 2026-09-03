"use client";

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
} from "@getpie/ui/components/combobox";
import { cn } from "@getpie/ui/lib/utils";
import type { ComponentProps } from "react";

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
  <ComboboxItem className={className} data-slot="model-selector-item" {...props}>
    <span className="flex min-w-0 items-center gap-2">{children}</span>
  </ComboboxItem>
);

export type ModelSelectorLogoProps = Omit<ComponentProps<"img">, "src" | "alt"> & {
  provider: string;
};

export const ModelSelectorLogo = ({ provider, className, ...props }: ModelSelectorLogoProps) => (
  <img
    alt={`${provider} logo`}
    className={cn("size-3 shrink-0 dark:invert", className)}
    data-slot="model-selector-logo"
    height={12}
    onError={(event) => {
      event.currentTarget.style.visibility = "hidden";
    }}
    src={`https://models.dev/logos/${provider}.svg`}
    width={12}
    {...props}
  />
);

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
