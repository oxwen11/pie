// UPSTREAM @earendil-works/pi-coding-agent@0.84.2 dist/main.js
// --session-id lookup: open if present in this cwd, otherwise create with that id.

import { SessionManager } from "@earendil-works/pi-coding-agent";

export async function openSessionManager(options: {
  cwd: string;
  sessionId: string;
  sessionDir?: string;
}): Promise<SessionManager> {
  const existing = (await SessionManager.list(options.cwd, options.sessionDir)).find(
    (session) => session.id === options.sessionId,
  );
  if (existing) return SessionManager.open(existing.path, options.sessionDir);
  return SessionManager.create(options.cwd, options.sessionDir, { id: options.sessionId });
}
