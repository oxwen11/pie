import type { ITheme } from "@xterm/xterm";

export function xtermThemeFromElement(host: HTMLElement): ITheme {
  const resolveToken = (token: string): string => {
    const probe = document.createElement("span");
    probe.style.color = `var(${token})`;
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    host.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  };

  return {
    background: resolveToken("--card"),
    foreground: resolveToken("--foreground"),
    cursor: resolveToken("--foreground"),
    cursorAccent: resolveToken("--card"),
    selectionBackground: resolveToken("--accent"),
    selectionForeground: resolveToken("--accent-foreground"),
    black: resolveToken("--background"),
    red: resolveToken("--destructive"),
    green: resolveToken("--success"),
    yellow: resolveToken("--warning"),
    blue: resolveToken("--info"),
    magenta: resolveToken("--chart-4"),
    cyan: resolveToken("--chart-2"),
    white: resolveToken("--foreground"),
    brightBlack: resolveToken("--muted-foreground"),
    brightRed: resolveToken("--destructive-foreground"),
    brightGreen: resolveToken("--success-foreground"),
    brightYellow: resolveToken("--warning-foreground"),
    brightBlue: resolveToken("--info-foreground"),
    brightMagenta: resolveToken("--chart-5"),
    brightCyan: resolveToken("--chart-3"),
    brightWhite: resolveToken("--card-foreground"),
  };
}

/** App appearance is `html.dark`. */
export function subscribeToAppTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributeFilter: ["class"],
    attributes: true,
  });
  return () => observer.disconnect();
}
