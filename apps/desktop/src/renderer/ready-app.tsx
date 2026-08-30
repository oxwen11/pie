import { AppInterface, type ServerConnection } from "@getpie/app";
import { use, useEffect, type ReactElement } from "react";

import { startupAnimation } from "./startup-animation";

export function ReadyApp({
  ready,
  connection,
  onReady,
}: {
  ready: Promise<void>;
  connection: ServerConnection;
  onReady: () => void;
}): ReactElement {
  use(ready);
  use(startupAnimation);
  useEffect(onReady, [onReady]);
  return <AppInterface server={connection} />;
}
