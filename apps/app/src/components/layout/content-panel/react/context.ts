import type { SessionRef, SessionWorkspace } from "@getpie/contract";
import { createContext, use } from "react";

import type { ContentPanel } from "../model/content-panel";
import type { AnyPanelView } from "./view";

export interface ContentPanelContextValue {
  readonly contentPanel: ContentPanel<AnyPanelView>;
  /** null outside a session route (`/draft`, `/`), where there is nothing to scope panels to. */
  readonly sessionRef: SessionRef | null;
  /** null outside a session route; the cwd Pi uses for this session. */
  readonly workspace: SessionWorkspace | null;
}

export const ContentPanelContext = createContext<ContentPanelContextValue | null>(null);

export function useContentPanelContext(): ContentPanelContextValue {
  const value = use(ContentPanelContext);
  if (value === null) {
    throw new Error("Content panel hooks need a <ContentPanelSessionProvider> above them.");
  }
  return value;
}
