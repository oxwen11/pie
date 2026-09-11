import type { ITheme } from "@xterm/xterm";

/** Resolve a CSS custom property to an rgb()/color xterm can paint. */
const resolveToken = (host: HTMLElement, token: string): string => {
  const probe = document.createElement("span");
  probe.style.color = `var(${token})`;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  host.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
};

export const xtermThemeFromElement = (host: HTMLElement): ITheme => ({
  background: resolveToken(host, "--card"),
  foreground: resolveToken(host, "--foreground"),
  cursor: resolveToken(host, "--foreground"),
  cursorAccent: resolveToken(host, "--card"),
  selectionBackground: resolveToken(host, "--accent"),
  selectionForeground: resolveToken(host, "--accent-foreground"),
  black: resolveToken(host, "--background"),
  red: resolveToken(host, "--destructive"),
  green: resolveToken(host, "--success"),
  yellow: resolveToken(host, "--warning"),
  blue: resolveToken(host, "--info"),
  magenta: resolveToken(host, "--chart-4"),
  cyan: resolveToken(host, "--chart-2"),
  white: resolveToken(host, "--foreground"),
  brightBlack: resolveToken(host, "--muted-foreground"),
  brightRed: resolveToken(host, "--destructive-foreground"),
  brightGreen: resolveToken(host, "--success-foreground"),
  brightYellow: resolveToken(host, "--warning-foreground"),
  brightBlue: resolveToken(host, "--info-foreground"),
  brightMagenta: resolveToken(host, "--chart-5"),
  brightCyan: resolveToken(host, "--chart-3"),
  brightWhite: resolveToken(host, "--card-foreground"),
});

/** App appearance is `html.dark`. */
export const subscribeToAppTheme = (onChange: () => void): (() => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributeFilter: ["class"],
    attributes: true,
  });
  return () => observer.disconnect();
};
