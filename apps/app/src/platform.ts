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

export type ConnectingSshHost = {
  readonly target: string;
  readonly blocking: boolean;
};

export type EnvironmentSnapshot = {
  readonly revision: number;
  readonly connecting: readonly ConnectingSshHost[];
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

/** The `pie` command a desktop build installs into `~/.local/bin`. */
export type CliCommandStatus = {
  /** `path` links to this app's command. */
  readonly installed: boolean;
  /** Display path, e.g. `~/.local/bin/pie`. */
  readonly path: string;
  /** Why Install would refuse to replace what is at `path`. */
  readonly conflict: string | null;
  /** New terminals find `path` (login PATH or the shell startup file). */
  readonly onPath: boolean;
  /** Another `pie` that comes first on the login PATH. */
  readonly shadowedBy: string | null;
};

export type PlatformCli = {
  readonly status: () => Promise<CliCommandStatus>;
  readonly install: () => Promise<CliCommandStatus>;
  readonly uninstall: () => Promise<CliCommandStatus>;
};

export type WindowChrome = {
  readonly titlebarHeight: number;
  readonly toggleInset: number;
};

export type PlatformBase = {
  /** Native window visibility (including minimization), combined with Page Visibility. */
  visibility?: {
    getSnapshot: () => boolean;
    subscribe: (listener: () => void) => () => void;
  };
  /** Close the host application when that operation exists. */
  quit?: () => void;
  /** Desktop host short hostname (e.g. `mac-mini`). Absent in the browser. */
  hostname?: string;
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
  /** Desktop-only: install the bundled `pie` command. Absent in the browser and in builds without it. */
  cli?: PlatformCli;
};

/** Browser or native capabilities supplied by the host entry point. */
export type Platform =
  | (PlatformBase & { os?: undefined })
  | (PlatformBase & { os: Exclude<PlatformOs, "macos"> })
  | (PlatformBase & { os: "macos"; windowChrome: WindowChrome });
