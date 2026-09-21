# T3 Code Tailscale — what pie copies

**Date:** 2026-08-26
**Source revision:** [`pingdotgg/t3code@78f462c4`](https://github.com/pingdotgg/t3code/tree/78f462c4)
**Question:** What does T3’s Tailscale package actually do, and how should pie use Tailscale?

## Executive summary

T3’s `@t3tools/tailscale` is an **advertise-this-machine** helper: read `Self`
from `tailscale status --json`, run `tailscale serve --bg --https=$port
http://127.0.0.1:$localPort`, then probe a pairing well-known URL. It does
**not** list tailnet peers as SSH targets.

Pie already decided that internet-from-anywhere for SSH-capable clients is
**SSH + MagicDNS**, with the daemon bound to loopback. So pie copies the CLI
wrappers and stderr redaction, then **lists online peers** so Add SSH host can
offer `machine.tailnet.ts.net`. Serve is opt-in for this computer’s local
daemon. Pairing / hosted catalog / Funnel stay out of scope.

## What T3 actually does

- Spawn `tailscale` / `tailscale.exe` with `shell: false`.
- `readTailscaleStatus` keeps **Self only** (MagicDNS + CGNAT IPv4).
- `ensureTailscaleServe` / `disableTailscaleServe`.
- Classify stderr into `not-logged-in` / `permission-denied` /
  `no-existing-handler` / `unknown` — never log raw stderr (`tskey-…`).
- Settings toggle “Enable Tailscale HTTPS”, then pairing from other devices.

## What pie copies

| T3                                 | Pie                                                          |
| ---------------------------------- | ------------------------------------------------------------ |
| PATH `tailscale` / `tailscale.exe` | Same PATH-only probe as OpenSSH                              |
| Self MagicDNS                      | `PIE_ALLOWED_HOSTS` on local daemon spawn + Serve URL        |
| Serve `--bg --https` → loopback    | Same, opt-in from the connection switcher                    |
| Stderr diagnostics, no raw log     | Same                                                         |
| Peer map ignored                   | **Used**: online peers → SSH discovery `source: "tailscale"` |
| Pairing well-known + HTTPS catalog | **Not copied**                                               |

`tailscale ssh` does not replace a local OpenSSH client for `ssh -L`.
