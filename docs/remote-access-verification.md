# Remote access verification

Verify the actual transport from an independent client, not just daemon health
on the host. Use isolated Pie homes and the repository's
[verification evidence rules](../.agents/rules/verify-evidence.md).
Old machine addresses, ports, and one-off run results are not a reusable test setup.

## Setup

Record the build identity, daemon home and address, client machine, transport,
and expected Environment UUID. Never include tokens in reports. Use spare ports;
do not replace an existing Tailscale Serve or relay configuration to run a test.

Except for the intentional SSH loopback tunnel, a client on a different machine
must reach the daemon through the transport under test. A host curling its own
LAN address proves only binding/Host handling, not cross-machine access.

| Path                  | Required proof                                                                                                                                                                           | Does not prove it                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| SSH                   | Desktop launches/attaches the remote daemon; renderer talks to local loopback; disconnect closes the tunnel while the remote daemon remains alive; incompatible builds refuse connection | Direct remote HTTP instead of the tunnel                |
| LAN                   | A second machine reaches the daemon over its LAN address and uses its authenticated UI/RPC                                                                                               | Same-host curl, SSH, or a tailnet address               |
| Tailscale             | Another tailnet node reaches the configured MagicDNS HTTPS endpoint and completes authenticated RPC                                                                                      | Loopback or LAN access                                  |
| Relay                 | Both sides use the outbound/public relay route; dropping the daemon's relay connection breaks that route while direct daemon health remains independent                                  | Access through MagicDNS or the tailnet IP               |
| Pairing               | A client without the SSH-launch token exchanges the pairing credential, obtains authorized RPC access, and remains authorized after reload                                               | Reusing the daemon token                                |
| Multiple Environments | One client addresses two daemon UUIDs independently; dropping one leaves the other working; the same daemon reached through different paths retains its identity                         | Replacing the whole app with a single active connection |

## Evidence and cleanup

For each path, retain the actual client URL (without secrets), action times,
health/RPC observations, and relevant daemon logs. For UI flows, include before
and after screenshots and video; a helper API call is not proof of the Desktop
click path. Distinguish blocked or unverified paths from passed ones.

Clean up only the tunnel, exposure, relay, and isolated homes created for this
run. Closing Desktop must not be used as proof that the resident daemon stopped.
Do not record a transient connection timeout as a successful check just because
an unrelated later request succeeded.

Related decisions: [daemon lifecycle](adr/0004-daemon-lifecycle-and-compatibility.md)
and [Environment routing](adr/0005-environment-rpc-routing.md).
