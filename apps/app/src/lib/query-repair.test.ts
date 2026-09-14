import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";

import { createQueryRepair } from "./query-repair";

it("repairs a notification received during an older read, coalescing its burst", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let complete!: (value: string) => void;
  const deferred = new Promise<string>((resolve) => {
    complete = resolve;
  });
  const queryFn = vi
    .fn<() => Promise<string>>()
    .mockReturnValueOnce(deferred)
    .mockResolvedValue("new");
  const observer = new QueryObserver(client, { queryKey: ["statuses"], queryFn });
  const unsubscribe = observer.subscribe(() => {});
  const repair = createQueryRepair(client, ["statuses"]);
  repair();
  repair();
  repair();
  complete("old");
  await vi.waitFor(() => expect(client.getQueryData(["statuses"])).toBe("new"));
  expect(queryFn.mock.calls.length).toBeLessThanOrEqual(3);
  unsubscribe();
  client.clear();
});

it("invalidates hidden reads without fetching them", async () => {
  const client = new QueryClient();
  const queryFn = vi.fn<() => Promise<string>>().mockResolvedValue("remote");
  const observer = new QueryObserver(client, { queryKey: ["detail"], queryFn, enabled: false });
  const unsubscribe = observer.subscribe(() => {});
  createQueryRepair(client, ["detail"])();
  await vi.waitFor(() => expect(client.getQueryState(["detail"])?.isInvalidated).toBe(true));
  expect(queryFn).not.toHaveBeenCalled();
  unsubscribe();
  client.clear();
});
