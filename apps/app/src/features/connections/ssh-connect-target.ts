/** Compose `user@host[:port]` for `ssh.connect` without pulling in `@getpie/ssh`. */
export function composeSshConnectTarget(input: {
  readonly host: string;
  readonly username: string;
  readonly port: string;
}): string {
  let hostname = input.host.trim();
  let username = input.username.trim();
  let port = input.port.trim();

  if (hostname.length === 0) {
    throw new Error("SSH host or alias is required.");
  }

  const at = hostname.lastIndexOf("@");
  if (at > 0) {
    const inlineUsername = hostname.slice(0, at).trim();
    hostname = hostname.slice(at + 1).trim();
    if (username.length === 0 && inlineUsername.length > 0) username = inlineUsername;
  }

  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/u.exec(hostname);
  if (bracketed) {
    hostname = (bracketed[1] ?? hostname).trim();
    if (port.length === 0 && bracketed[2]) port = bracketed[2];
  } else {
    const colon = hostname.lastIndexOf(":");
    if (colon > 0 && hostname.indexOf(":") === colon && /^\d+$/u.test(hostname.slice(colon + 1))) {
      if (port.length === 0) port = hostname.slice(colon + 1);
      hostname = hostname.slice(0, colon).trim();
    }
  }

  if (hostname.length === 0) throw new Error("SSH host or alias is required.");
  if (port.length > 0) {
    const parsed = Number.parseInt(port, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
      throw new Error("SSH port must be between 1 and 65535.");
    }
    port = String(parsed);
  }

  const withUser = username.length > 0 ? `${username}@${hostname}` : hostname;
  return port.length > 0 ? `${withUser}:${port}` : withUser;
}
