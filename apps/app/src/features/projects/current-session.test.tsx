// @vitest-environment jsdom
import type { SessionRef } from "@getpie/contract";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { sameSessionRef } from "@/lib/session-ref";

import { CurrentSessionProvider, useCurrentSession } from "./current-session";

const first: SessionRef = {
  projectId: "11111111-1111-4111-8111-111111111111",
  sessionId: "shared-session-id",
};
const otherProject: SessionRef = {
  projectId: "22222222-2222-4222-8222-222222222222",
  sessionId: first.sessionId,
};

function SessionProbe({ candidate }: { readonly candidate: SessionRef }) {
  const isSessionActive = useCurrentSession();
  return <output data-testid="active">{isSessionActive(candidate) ? "active" : "inactive"}</output>;
}

function MutationProbe({
  candidate,
  onResult,
}: {
  readonly candidate: SessionRef;
  readonly onResult: (active: boolean) => void;
}) {
  const isSessionActive = useCurrentSession();
  return (
    <button type="button" onClick={() => onResult(isSessionActive(candidate))}>
      Archive
    </button>
  );
}

describe("CurrentSessionProvider", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  it("updates active highlighting when the composition root supplies a new checker", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <CurrentSessionProvider isSessionActive={(candidate) => sameSessionRef(candidate, first)}>
          <SessionProbe candidate={first} />
        </CurrentSessionProvider>,
      );
    });
    expect(container.querySelector("[data-testid='active']")?.textContent).toBe("active");

    act(() => {
      root?.render(
        <CurrentSessionProvider
          isSessionActive={(candidate) => sameSessionRef(candidate, otherProject)}
        >
          <SessionProbe candidate={first} />
        </CurrentSessionProvider>,
      );
    });
    expect(container.querySelector("[data-testid='active']")?.textContent).toBe("inactive");
  });

  it("checks the latest route-backed identity when an action settles", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    let current: SessionRef = first;
    let result: boolean | undefined;

    act(() => {
      root?.render(
        <CurrentSessionProvider isSessionActive={(candidate) => sameSessionRef(candidate, current)}>
          <MutationProbe candidate={first} onResult={(active) => (result = active)} />
        </CurrentSessionProvider>,
      );
    });

    current = otherProject;
    act(() => container?.querySelector("button")?.click());

    expect(result).toBe(false);
  });
});
