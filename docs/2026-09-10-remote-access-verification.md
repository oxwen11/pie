# Remote access verification field

How to prove Pie remote Environments on the machines we actually have.
Companion to [`2026-08-26-remote-ssh-server-design.md`](./2026-08-26-remote-ssh-server-design.md)
(Desktop SSH launch) and the T3 notes in
[`research/2026-08-26-t3code-remote-ssh.md`](./research/2026-08-26-t3code-remote-ssh.md).

Checked 2026-09-10. Tailnet MagicDNS suffix: `tail590c10.ts.net`.

## What this field is for

| Capability            | Meaning to prove                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| **SSH**               | Desktop Main launches/attaches a remote `pie` daemon and the renderer talks only to `127.0.0.1`.         |
| **LAN**               | A second machine on the same Wi-Fi/Ethernet opens the daemon without SSH.                                |
| **Tailscale**         | A tailnet peer opens MagicDNS HTTPS (Serve). Daemon may stay on loopback.                                |
| **Relay**             | Client is not on the tailnet and the daemon has no inbound port; both sides connect **out** to racknerd. |
| **Pairing**           | A browser that did not run SSH obtains a ticket and keeps a session across reload.                       |
| **Multi-environment** | One client holds more than one daemon at once (this computer + a remote).                                |

Not in this field: native Mobile App, hosted `app.pie.*`, T3 Connect / Cloudflare. iOS Safari is optional later (`node` is on the tailnet; `iphone171` has been offline).

## Machines

| Role                                 | How to reach                                                        | LAN                                  | Tailscale                                         | Notes                                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Mini** (agent host, Desktop)       | this machine                                                        | `192.168.31.135`, also `192.168.1.2` | `100.78.197.55` `mac-mini`                        | Drive the browser here. Clash TUN `198.18.0.1`.                                                                                                                    |
| **MBP** (second client)              | `ssh dinq@macbook-pro-m1` (`IdentityFile ~/.ssh/id_ed25519_iamdin`) | `192.168.31.35`                      | `100.98.17.31` `macbook-pro-m1.tail590c10.ts.net` | CLI is `/usr/local/bin/tailscale` (login PATH may omit it).                                                                                                        |
| **racknerd** (remote daemon + relay) | `ssh root@100.88.65.47`                                             | none (VPS)                           | `100.88.65.47` `racknerd-5617bf0`                 | Public `96.44.165.19`. Bundled `pie` in `~/.local/bin`. **Tailscale Serve `:443` is already taken** (likely T3) — Pie Serve/relay uses another port (e.g. `8443`). |

LAN between Mini and MBP is **`192.168.31.0/24` only**. Do not use Mini’s `192.168.1.2` as the LAN URL for the MBP.

## How to operate each side

- **Mini browser:** this agent’s browser tools. Prefer the URL under test (`http://192.168.31.135:…` or `https://….ts.net/`), never `127.0.0.1` when proving LAN/Tailscale.
- **MBP client:** `ssh dinq@macbook-pro-m1` then `curl` (always). A real window needs a logged-in GUI session (`open`).
- **racknerd:** SSH as root. Confirm `ss`/`curl` on loopback vs `100.88.65.47` vs `96.44.165.19`.
- **Clash TUN:** on Mini and MBP, check the request actually hits the daemon (source address / daemon logs), not the proxy.

A check is only done when the **client is a different machine** from the daemon, except SSH (renderer is loopback by design).

## Methods

### SSH (Desktop)

Daemon on racknerd (or any SSH host). Client is Mini Desktop.

1. Environment switcher → `root@100.88.65.47` (or `root@racknerd-5617bf0`).
2. `ServerConnection` is `http://127.0.0.1:<local>` / `ws://127.0.0.1:<local>` plus a daemon token.
3. `GET /api/health` on that loopback URL body is exactly `ok`.
4. Persist file is `$PIE_HOME/storage/ssh-environments.json` `{ version, data: { environments } }`, **no token**, **no activeId**.
5. Remove: loopback port dies; remote `~/.pie/daemon/daemon.pid` still live.
6. Restart Desktop reconnects every saved remote; the window stays on the local daemon.

Already exercised 2026-09-10 via shipped `makeDesktopSsh.connect` (not the Electron click path).

### LAN

Daemon on **Mini**, bind not only loopback. Client is **MBP**.

1. Mini: daemon accepts `192.168.31.135`.
2. From MBP: `curl -sv http://192.168.31.135:<port>/api/health` → `ok`. Opening `http://127.0.0.1:<port>` from MBP must **fail**.
3. MBP browser (or Mini browser pointed at `http://192.168.31.135:<port>`, weaker) completes pairing against that origin.
4. Host header / CORS must allow `http://192.168.31.135:<port>`, not a `*.ts.net` wildcard.

Mini curling its own `192.168.31.135` only proves bind + Host. The MBP step is the LAN proof.

### Tailscale

Daemon on Mini or racknerd; Serve HTTPS to loopback. Client is the **other** tailnet node’s browser.

1. Serve on an unused HTTPS port (racknerd: not `443`).
2. Client opens `https://<magicdns>/` (Mini: `mac-mini.tail590c10.ts.net`, MBP: `macbook-pro-m1.tail590c10.ts.net`, VPS: `racknerd-5617bf0.tail590c10.ts.net` — confirm with `tailscale status --json` `Self.DNSName`).
3. Pairing + RPC/WebSocket succeed over that origin.
4. Same daemon still reachable via SSH from Mini Desktop (two access paths, one Environment).

### Relay

Daemon on **Mini** (home, no inbound). Relay process on **racknerd**. Client is MBP or Mini browser using racknerd’s **public IP**, not `100.x` / MagicDNS.

1. Mini daemon connects **out** to `96.44.165.19:<relay-port>`.
2. Client opens `http://96.44.165.19:<relay-port>/` (or HTTPS if the hop has TLS) **without** Tailscale. This field’s hop is HTTP `:18443` (control/data `:18444`).
3. Pairing + RPC work. Killing Mini’s outbound relay connection drops the client; daemon can stay up.
4. Control: the same client URL must not be the LAN or MagicDNS address.

### Pairing

Any exposed URL from LAN / Tailscale / relay.

1. Client has no SSH-launch token.
2. Open the pairing link/code the daemon minted; ticket exchange succeeds.
3. Reload the page: session still authorized (not a one-shot URL in the address bar).
4. Second client (other browser profile or the other Mac) can pair; first client stays up unless revoked.

### Multi-environment

One client, two daemons: Mini local + racknerd (Tailscale or SSH).

1. Both Environments show as connected.
2. A project/session on Mini is not the racknerd list.
3. Dropping one Environment does not disconnect the other.
4. Desktop SSH to racknerd and a browser paired to the same racknerd daemon are the same Environment, not two rows for one machine.

## Pass / fail shortcuts

| Claim             | Fail if                                                                           |
| ----------------- | --------------------------------------------------------------------------------- |
| LAN               | MBP can only reach Mini via `100.78.197.55` or SSH.                               |
| Tailscale         | Browser used `127.0.0.1` or `192.168.31.x`.                                       |
| Relay             | Client used MagicDNS / `100.x`, or Mini accepted an inbound port from the client. |
| Pairing           | Client reused the SSH-launch daemon token.                                        |
| Multi-environment | Switching Environments remounts the whole app onto a single `ServerConnection`.   |
| SSH               | Renderer `httpBaseUrl` is not loopback, or disconnect stops the remote daemon.    |

## Field run 2026-09-10

Ports chosen so we do **not** take racknerd `:443` or Mini Tailscale Serve `:8443` (`127.0.0.1:3773`).

| Path              | Daemon                                                                                                                             | Client                  | URL / hop                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LAN               | Mini `pie serve --port 18480 --host 0.0.0.0` with `--allowed-host 192.168.31.135`, `mac-mini.tail590c10.ts.net`, `96.44.165.19`    | MBP                     | `http://192.168.31.135:18480` health `ok`; MBP `http://127.0.0.1:18480` connection refused                                                                                       |
| Tailscale         | same Mini serve; `tailscale serve --bg --https=18483 http://127.0.0.1:18480` then `--https=18483 off`                              | MBP                     | `https://mac-mini.tail590c10.ts.net:18483` (not LAN, not `127.0.0.1`, not `:443`)                                                                                                |
| Relay             | Mini outbound attach `96.44.165.19:18444` → `127.0.0.1:18480`; racknerd `pie relay listen --port 18443 --public-host 96.44.165.19` | Mini or MBP             | `http://96.44.165.19:18443` only — not `100.x`, not `.ts.net`, not `192.168.31.x`. Drop Mini attach → empty reply; Mini LAN daemon stays up                                      |
| Pairing           | mint with daemon token on the daemon; exchange **without** that token                                                              | MBP or Mini             | `POST /api/pairing/exchange` then `POST /api/ws-ticket` with the session token                                                                                                   |
| SSH               | Mini Desktop `makeDesktopSsh.connect("root@100.88.65.47")`                                                                         | renderer                | `http://127.0.0.1:<ephemeral>`; persist `ssh-environments.json` has host, **no token**; disconnect kills loopback, remote `daemon.pid` `3837049` on `127.0.0.1:35853` still `ok` |
| Multi-environment | one process                                                                                                                        | Mini LAN + racknerd SSH | both health `ok`; drop SSH → Mini still `ok`, SSH loopback dead                                                                                                                  |

### Commands

Mini LAN serve (scratch `PIE_HOME` / `PIE_DAEMON_DIR`; `PIE_AUTH_TOKEN` set):

```bash
node packages/pie/dist/cli.mjs serve --port 18480 --host 0.0.0.0 \
  --allowed-host 192.168.31.135 \
  --allowed-host mac-mini.tail590c10.ts.net \
  --allowed-host 96.44.165.19
```

MBP LAN:

```bash
ssh dinq@macbook-pro-m1
curl -sv http://192.168.31.135:18480/api/health   # ok
curl -sv http://127.0.0.1:18480/api/health        # fail
```

Tailscale Serve (Mini). Restore `:8443` if you ever overwrite it.

```bash
tailscale serve --bg --https=18483 http://127.0.0.1:18480
# client: https://mac-mini.tail590c10.ts.net:18483/api/health
tailscale serve --https=18483 off
```

Relay (racknerd listen, Mini attach, client public IP):

The hop is `pie-relay` (`packages/pie/dist/relay.mjs`) — copy that file only; it does not need a pie daemon or the web UI.

```bash
# racknerd (standalone hop)
PIE_RELAY_TOKEN=… node pie-relay.mjs --port 18443 --public-host 96.44.165.19
# Mini, foreground serve:
PIE_RELAY_TOKEN=… pie relay attach --to 96.44.165.19:18443 --local 127.0.0.1:18480
# Mini, daemon:
PIE_RELAY_TOKEN=… pie relay attach --to 96.44.165.19:18443
# client
curl http://96.44.165.19:18443/api/health
```

Clash TUN on Mini/MBP (`198.18.0.1`) can drop or stall individual TCP streams to `96.44.165.19`. A timed-out GET with a later 200 POST on the same attach still counts; fail the claim only when no request from that client URL ever reaches the daemon.

Unauthenticated local `pie serve` (`:4180`, Vite `:4190`, no `PIE_AUTH_TOKEN`): `POST /api/pairing/exchange` is 404, and the SPA must load without a pairing gate.
