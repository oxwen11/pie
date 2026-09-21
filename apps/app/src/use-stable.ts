import { useRef } from "react";

/** Create once per mount — composition-root singletons, not updatable state. */
export function useStable<T>(create: () => T): T {
  const ref = useRef<T | null>(null);
  // Null-guarded lazy init during render is the documented create-once pattern
  // (https://react.dev/reference/react/useRef#avoiding-recreating-the-ref-contents).
  // `react/refs` forbids any `.current` read in render; this ref is the store, not a subscription.
  /* oxlint-disable react/refs */
  if (ref.current === null) {
    const created = create();
    // Create-once composition-root singleton. React documents this null-guarded
    // write during render; the detector still flags the assignment.
    // react-doctor-disable-next-line no-ref-current-in-render
    ref.current = created;
    return created;
  }
  return ref.current;
  /* oxlint-enable react/refs */
}
