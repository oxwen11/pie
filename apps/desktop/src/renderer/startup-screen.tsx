import type { ReactElement } from "react";

import pieLogoUrl from "../../resources/pie.svg?url";

import "./startup-screen.css";

export function StartupScreen(): ReactElement {
  return (
    <main
      className="bg-background fixed inset-0 z-40 grid place-items-center"
      aria-label="Starting Pie"
    >
      <div
        className="pie-startup-logo"
        style={{
          WebkitMaskImage: `url("${pieLogoUrl}")`,
          maskImage: `url("${pieLogoUrl}")`,
        }}
        aria-hidden="true"
      >
        <span className="pie-startup-logo-shimmer" />
      </div>
    </main>
  );
}
