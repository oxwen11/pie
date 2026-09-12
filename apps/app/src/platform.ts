/** The OS a native host runs on. `undefined` means the browser. */
export type PlatformOs = "macos" | "windows" | "linux";

export type SshRemoteEnvironment = {
  readonly id: string;
  readonly environmentId: string;
  readonly label: string;
  readonly alias: string;
  readonly connection: {
    readonly httpBaseUrl: string;
    readonly wsBaseUrl: string;
    readonly token: string;
  };
};

export type EnvironmentSnapshot = {
  readonly revision: number;
  readonly connectingLabel: string | null;
  readonly remotes: readonly SshRemoteEnvironment[];
};

export type DiscoveredSshHost = {
  readonly alias: string;
  readonly hostname: string;
  readonly username: string | null;
  readonly port: number | null;
  readonly source: "ssh-config" | "tailscale";
};

/** How the UI observes which server the desktop host is talking to. */
export type EnvironmentFeed = {
  getSnapshot: () => EnvironmentSnapshot;
  subscribe: (listener: (snapshot: EnvironmentSnapshot) => void) => () => void;
};

export type SshClientAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly message: string };

export type PlatformSsh = {
  readonly client: SshClientAvailability;
  readonly environments: EnvironmentFeed;
  readonly discoverHosts: () => Promise<readonly DiscoveredSshHost[]>;
  readonly connect: (target: string) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
};

export type TailscaleClientAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly message: string };

export type TailscaleSnapshot = {
  readonly client: TailscaleClientAvailability;
  readonly loggedIn: boolean;
  readonly magicDnsName: string | null;
  readonly httpsBaseUrl: string | null;
  readonly serveEnabled: boolean;
};

export type PlatformTailscale = {
  readonly client: TailscaleClientAvailability;
  readonly snapshot: () => Promise<TailscaleSnapshot>;
  readonly enableServe: () => Promise<void>;
  readonly disableServe: () => Promise<void>;
};

/** Browser or native capabilities supplied by the host entry point. */
export type Platform = {
  /** Close the host application when that operation exists. */
  quit?: () => void;
  /**
   * The desktop host's OS, left unset by the browser entry point. macOS draws
   * native traffic lights over the shell's top-left corner; everywhere else
   * that corner is ours to fill — see `components/layout/shell-chrome.ts`.
   */
  os?: PlatformOs;
  /**
   * Desktop-only: SSH-forwarded remote pie daemons, all connected in parallel.
   * Absent in the browser. On desktop, `client.available` is false when OpenSSH
   * is not on PATH.
   */
  ssh?: PlatformSsh;
  /**
   * Desktop-only: Tailscale CLI on PATH. Used to list MagicDNS peers as SSH
   * hosts and optionally `tailscale serve` this computer's daemon. Absent in
   * the browser. `client.available` is false when `tailscale` is not on PATH.
   */
  tailscale?: PlatformTailscale;
};
