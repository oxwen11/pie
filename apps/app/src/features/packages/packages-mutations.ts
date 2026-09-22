import type { PackageItem } from "@getpie/contract/packages";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useLocalOrpc } from "@/lib/environment-orpc";

export function usePackageMutations(onAdded: () => void) {
  const orpcQueryUtils = useLocalOrpc();
  const queryClient = useQueryClient();
  const listKey = orpcQueryUtils.packages.list.queryOptions().queryKey;
  const add = useMutation({
    mutationFn: (next: string) => orpcQueryUtils.packages.add.call({ source: next }),
    onSuccess: (item) => {
      onAdded();
      queryClient.setQueryData(listKey, (current: ReadonlyArray<PackageItem> | undefined) => {
        const items = current ?? [];
        if (items.some((entry) => entry.source === item.source)) {
          return items.map((entry) => (entry.source === item.source ? item : entry));
        }
        return [...items, item];
      });
      toast.success("Saved. Next session start installs missing packages.");
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (next: string) => orpcQueryUtils.packages.remove.call({ source: next }),
    onSuccess: (_result, next) => {
      queryClient.setQueryData(listKey, (current: ReadonlyArray<PackageItem> | undefined) =>
        (current ?? []).filter((entry) => entry.source !== next),
      );
      toast.success("Removed from Pi settings");
    },
    onError: (error) => toast.error(error.message),
  });
  return { add, remove };
}
