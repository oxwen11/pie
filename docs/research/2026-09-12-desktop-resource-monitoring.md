# Desktop resource monitoring in T3 Code, OpenCode beta, and Superset

## Scope

This note examines how T3 Code, the OpenCode beta desktop branch, and Superset measure memory and related process resources. It also compares a standalone sidecar with collection inside Pie's daemon or Electron main process and recommends a design for Pie's Electron, daemon, and Pi process trees.

Source snapshots:

- T3 Code `main` at [`57aee3e19f1910f3323f06384bb2a1d02b79e369`](https://github.com/pingdotgg/t3code/tree/57aee3e19f1910f3323f06384bb2a1d02b79e369)
- OpenCode `beta` at [`0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5`](https://github.com/anomalyco/opencode/tree/0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5)
- Superset `main` at [`ea15c2189c89873b842bd144523567a21c2a48e3`](https://github.com/superset-sh/superset/tree/ea15c2189c89873b842bd144523567a21c2a48e3)

## Executive summary

T3 Code has the most complete production resource-telemetry subsystem. A standalone Rust sidecar samples the server and Electron process trees with `sysinfo`; Electron main separately supplies Electron process metrics and host power state. The server merges both sources into per-process and aggregate views, exposes live subscriptions and history, and keeps bounded in-memory history.

Superset proves that a sidecar is not technically required. Its Electron main process asks host services for live terminal root PIDs, takes one machine-wide process snapshot with `ps` or PowerShell, aggregates each terminal subtree, and merges that with `app.getAppMetrics()`. The UI requests data only while its resource popover is open. This is simpler than T3, but collection shares Electron main's event loop and lifecycle, has no history, and omits the host-service and PTY-daemon processes themselves.

OpenCode beta does not have an equivalent desktop-wide process monitor. Its production desktop main process starts or connects to the background CLI service, but does not sample Electron, service, or child-process memory. Its memory measurements are development, test, or TUI diagnostics rather than a production process-family monitor.

A daemon can perform OS collection and self-report runtime memory. A sidecar's main benefit is observer independence during daemon stalls, not access to otherwise unavailable heap internals. Continued evidence after owner exit requires an explicit sidecar shutdown and persistence policy; process isolation alone does not preserve memory-only history.

The subsequent design discussion selected a sidecar with **separate writers**: OS samples in `resources/os/`, daemon runtime samples in `resources/daemon/`, and Electron samples in `resources/electron/`. All use date-named `.jsonl` files, with no runId directory. The current proposal and host-write review gates are in [Resource monitoring](../design/resource-monitoring.md). The earlier daemon-first recommendation is superseded.

## T3 Code

### Architecture

T3 deliberately keeps native collection outside Node. Its design note says this isolates collector crashes, avoids a Node/Electron addon ABI matrix, and lets the server continue when the collector is absent or fails.

Source: [`docs/internals/resource-telemetry.md#L1-L7`](https://github.com/pingdotgg/t3code/blob/57aee3e19f1910f3323f06384bb2a1d02b79e369/docs/internals/resource-telemetry.md#L1-L7).

The data path is:

```text
Electron main
  ├─ app.getAppMetrics()
  ├─ power / idle / lock / thermal state
  └─ inherited telemetry FD 4
                 │
                 ▼
T3 server ── NDJSON commands ──> Rust resource-monitor sidecar
  │                                ├─ sysinfo process scan
  │                                ├─ server process tree
  │                                ├─ registered Electron root tree
  │                                └─ bounded in-memory history
  │
  ├─ merge native + Electron samples
  ├─ classify processes
  ├─ aggregate CPU / RSS / I/O
  └─ WebSocket live data and history APIs
                 ▲
                 │
          inherited control FD 5
```

Desktop config reserves FDs 4 and 5 for telemetry and control, and the process launcher wires those inherited streams independently of renderer connectivity.

Sources:

- [`apps/desktop/src/backend/DesktopBackendConfiguration.ts#L485-L499`](https://github.com/pingdotgg/t3code/blob/57aee3e19f1910f3323f06384bb2a1d02b79e369/apps/desktop/src/backend/DesktopBackendConfiguration.ts#L485-L499)
- [`apps/desktop/src/backend/DesktopBackendManager.ts#L458-L478`](https://github.com/pingdotgg/t3code/blob/57aee3e19f1910f3323f06384bb2a1d02b79e369/apps/desktop/src/backend/DesktopBackendManager.ts#L458-L478)
- [`docs/internals/resource-telemetry.md#L22-L27`](https://github.com/pingdotgg/t3code/blob/57aee3e19f1910f3323f06384bb2a1d02b79e369/docs/internals/resource-telemetry.md#L22-L27)

### What is measured

The native protocol reports process identity and tree fields, CPU, resident and virtual memory, I/O, command, and status. It identifies processes with PID plus start time, reducing PID-reuse mistakes. The Rust collector converts `sysinfo` start time from seconds to milliseconds and rounds external start times to that precision; a millisecond-named field does not provide millisecond identity resolution or eliminate same-second reuse ambiguity.

Sources:

- [`packages/contracts/src/resourceTelemetry.ts#L50-L89`](https://github.com/pingdotgg/t3code/blob/57aee3e19f1910f3323f06384bb2a1d02b79e369/packages/contracts/src/resourceTelemetry.ts#L50-L89)
- [`native/resource-monitor/src/main.rs#L599-L607`](https://github.com/pingdotgg/t3code/blob/57aee3e19f1910f3323f06384bb2a1d02b79e369/native/resource-monitor/src/main.rs#L599-L607)
- [`docs/internals/resource-telemetry.md#L29-L38`](https://github.com/pingdotgg/t3code/blob/57aee3e19f1910f3323f06384bb2a1d02b79e369/docs/internals/resource-telemetry.md#L29-L38)

The server classifies rows as server, server child, provider root, terminal root, Electron main/renderer/GPU/utility, or resource monitor. It computes aggregate current RSS by summing resident bytes across the relevant processes.

Sources:

- [`packages/contracts/src/resourceTelemetry.ts#L27-L39`](https://github.com/pingdotgg/t3code/blob/57aee3e19f1910f3323f06384bb2a1d02b79e369/packages/contracts/src/resourceTelemetry.ts#L27-L39)
- [`apps/server/src/resourceTelemetry/Model.ts#L469-L543`](https://github.com/pingdotgg/t3code/blob/57aee3e19f1910f3323f06384bb2a1d02b79e369/apps/server/src/resourceTelemetry/Model.ts#L469-L543)
- [`apps/server/src/resourceTelemetry/Model.ts#L349-L364`](https://github.com/pingdotgg/t3code/blob/57aee3e19f1910f3323f06384bb2a1d02b79e369/apps/server/src/resourceTelemetry/Model.ts#L349-L364)

Electron main calls `app.getAppMetrics()` only when diagnostics demand exists. It maps Electron CPU and working-set values into the desktop telemetry message.

Source: [`apps/desktop/src/telemetry/DesktopTelemetryPublisher.ts#L205-L217`](https://github.com/pingdotgg/t3code/blob/57aee3e19f1910f3323f06384bb2a1d02b79e369/apps/desktop/src/telemetry/DesktopTelemetryPublisher.ts#L205-L217), [`#L270-L287`](https://github.com/pingdotgg/t3code/blob/57aee3e19f1910f3323f06384bb2a1d02b79e369/apps/desktop/src/telemetry/DesktopTelemetryPublisher.ts#L270-L287).

### Sampling, streaming, and history

Normal live sampling is one second. Background or unknown-power operation uses five seconds; battery uses five seconds; lock, suspend, serious thermal state, and similar constraints use fifteen seconds. The server enables sidecar streaming only while live subscribers exist.

Sources:

- [`apps/server/src/resourceTelemetry/NativeTelemetryClient.ts#L42-L53`](https://github.com/pingdotgg/t3code/blob/57aee3e19f1910f3323f06384bb2a1d02b79e369/apps/server/src/resourceTelemetry/NativeTelemetryClient.ts#L42-L53)
- [`apps/server/src/resourceTelemetry/NativeTelemetryClient.ts#L261-L278`](https://github.com/pingdotgg/t3code/blob/57aee3e19f1910f3323f06384bb2a1d02b79e369/apps/server/src/resourceTelemetry/NativeTelemetryClient.ts#L261-L278)
- [`apps/server/src/resourceTelemetry/NativeTelemetryClient.ts#L778-L830`](https://github.com/pingdotgg/t3code/blob/57aee3e19f1910f3323f06384bb2a1d02b79e369/apps/server/src/resourceTelemetry/NativeTelemetryClient.ts#L778-L830)

The sidecar records samples even when streaming is disabled. History is bounded independently by one hour, 3,600 snapshots, 20,000 retained process rows, and 64 MiB. This prevents diagnostics from becoming its own memory leak.

Sources:

- [`native/resource-monitor/src/main.rs#L11-L23`](https://github.com/pingdotgg/t3code/blob/57aee3e19f1910f3323f06384bb2a1d02b79e369/native/resource-monitor/src/main.rs#L11-L23)
- [`native/resource-monitor/src/main.rs#L252-L337`](https://github.com/pingdotgg/t3code/blob/57aee3e19f1910f3323f06384bb2a1d02b79e369/native/resource-monitor/src/main.rs#L252-L337)
- [`native/resource-monitor/src/main.rs#L815-L827`](https://github.com/pingdotgg/t3code/blob/57aee3e19f1910f3323f06384bb2a1d02b79e369/native/resource-monitor/src/main.rs#L815-L827)

### Important limits

- History is memory-only: there is no telemetry database or recurring shell-probe fallback.
- Historical replay does not contain historical Electron CPU/memory values; merging the latest Electron values would corrupt the past.
- Sampling can miss short-lived processes between intervals.
- WSL native process telemetry is currently unavailable because the Windows package does not include the Linux monitor binary.

Source: [`docs/internals/resource-telemetry.md#L9-L20`](https://github.com/pingdotgg/t3code/blob/57aee3e19f1910f3323f06384bb2a1d02b79e369/docs/internals/resource-telemetry.md#L9-L20), [`#L29-L50`](https://github.com/pingdotgg/t3code/blob/57aee3e19f1910f3323f06384bb2a1d02b79e369/docs/internals/resource-telemetry.md#L29-L50).

## OpenCode beta

### Production desktop

OpenCode desktop starts or connects to a separate CLI background service with `@opencode/client/service`. This code records lifecycle information such as service version and endpoint, but it does not collect memory or CPU metrics for Electron or the service process.

Source: [`packages/desktop/src/main/service/background-service.ts#L29-L61`](https://github.com/anomalyco/opencode/blob/0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5/packages/desktop/src/main/service/background-service.ts#L29-L61).

A repository-wide search of the beta snapshot found no desktop use of Electron `app.getAppMetrics()` and no production process-tree sampler comparable to T3's Rust monitor.

OpenCode does have event-triggered hang diagnostics. When a renderer becomes unresponsive, desktop main samples JavaScript call stacks once per second for up to fifteen seconds and logs an aggregated stack report. This diagnoses hangs, not memory use.

Sources:

- [`packages/desktop/src/main/windows/unresponsive.ts#L5-L75`](https://github.com/anomalyco/opencode/blob/0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5/packages/desktop/src/main/windows/unresponsive.ts#L5-L75)
- [`packages/desktop/src/main/windows/recovery.ts#L132-L145`](https://github.com/anomalyco/opencode/blob/0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5/packages/desktop/src/main/windows/recovery.ts#L132-L145)

### Renderer debug bar

The shared app's debug bar is mounted only when `import.meta.env.DEV` is true. While visible, it polls once per second and reads Chromium's non-standard `performance.memory` values, including `usedJSHeapSize` and `jsHeapSizeLimit`. It also measures FPS, long tasks, event delay, INP, and CLS.

Sources:

- [`packages/app/src/shell/shell.tsx#L55-L63`](https://github.com/anomalyco/opencode/blob/0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5/packages/app/src/shell/shell.tsx#L55-L63), [`#L104-L110`](https://github.com/anomalyco/opencode/blob/0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5/packages/app/src/shell/shell.tsx#L104-L110)
- [`packages/app/src/shell/debug/debug-bar.tsx#L301-L305`](https://github.com/anomalyco/opencode/blob/0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5/packages/app/src/shell/debug/debug-bar.tsx#L301-L305)
- [`packages/app/src/shell/debug/debug-bar.tsx#L407-L425`](https://github.com/anomalyco/opencode/blob/0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5/packages/app/src/shell/debug/debug-bar.tsx#L407-L425)

This is renderer JS heap, not renderer RSS and not total desktop memory. It is not retained as diagnostic history or written continuously to logs.

### E2E performance memory benchmarks

OpenCode's explicit performance benchmarks use Chrome DevTools Protocol to force garbage collection, read `Runtime.getHeapUsage`, and count DOM nodes. The project documentation warns that these values exclude worker heaps, Electron main/GPU processes, and the OpenCode server and must not be reported as total desktop RAM.

Source: [`packages/app/e2e/performance/README.md#L141-L150`](https://github.com/anomalyco/opencode/blob/0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5/packages/app/e2e/performance/README.md#L141-L150).

These benchmarks are useful for regression testing retained renderer state, not operational monitoring.

### TUI devtools RSS

The TUI devtools bar samples its own Node process every two seconds using `process.memoryUsage().rss`, together with CPU and event-loop delay. It keeps only the latest thirty seconds in component state.

Source: [`packages/tui/src/component/devtools-bar.tsx#L21-L27`](https://github.com/anomalyco/opencode/blob/0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5/packages/tui/src/component/devtools-bar.tsx#L21-L27), [`#L112-L140`](https://github.com/anomalyco/opencode/blob/0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5/packages/tui/src/component/devtools-bar.tsx#L112-L140).

This is the only continuous RSS sampling found in the beta snapshot, but it is local TUI debug UI state. It does not monitor the desktop process family and does not persist samples.

## Superset

### Architecture: Electron main as coordinator

Superset does not use a resource-monitor sidecar. Its Electron main process coordinates collection:

```text
host-service / PTY daemon
  └─ live terminal session IDs, workspace IDs, and root PIDs
                         │
                         ▼
Electron main resource collector
  ├─ one machine-wide ps / PowerShell snapshot
  ├─ terminal-root descendant aggregation
  ├─ macOS proc_pid_rusage physical-footprint enrichment
  ├─ app.getAppMetrics() for Electron process classes
  └─ os.totalmem() / os.freemem() / load average
                         │
                         ▼
              tRPC snapshot to renderer
```

For its newer host-service path, Electron main calls an authenticated loopback endpoint to obtain each live terminal's root PID and workspace attribution. The host service obtains those PIDs from the PTY daemon; it does not perform the resource scan itself.

Sources:

- [`apps/desktop/src/main/lib/resource-metrics/session-sources.ts#L70-L125`](https://github.com/superset-sh/superset/blob/ea15c2189c89873b842bd144523567a21c2a48e3/apps/desktop/src/main/lib/resource-metrics/session-sources.ts#L70-L125)
- [`packages/host-service/src/terminal/resource-sessions.ts#L13-L70`](https://github.com/superset-sh/superset/blob/ea15c2189c89873b842bd144523567a21c2a48e3/packages/host-service/src/terminal/resource-sessions.ts#L13-L70)

### Process-tree collection

On macOS and Linux, Superset runs one asynchronous `ps -eo pid=,ppid=,pcpu=,rss=` command. Tree structure and resource counters therefore come from the same collection batch, reducing the race window in its older `pidtree` then `pidusage` implementation; `ps` is not an atomic snapshot of a changing OS process table. On Windows it uses PowerShell `Get-CimInstance Win32_Process` for PID, parent PID, and working set, then bulk-enriches the relevant PIDs with `pidusage` CPU values.

Sources:

- [`apps/desktop/src/main/lib/resource-metrics/process-tree.ts#L40-L70`](https://github.com/superset-sh/superset/blob/ea15c2189c89873b842bd144523567a21c2a48e3/apps/desktop/src/main/lib/resource-metrics/process-tree.ts#L40-L70)
- [`apps/desktop/src/main/lib/resource-metrics/process-tree.ts#L153-L215`](https://github.com/superset-sh/superset/blob/ea15c2189c89873b842bd144523567a21c2a48e3/apps/desktop/src/main/lib/resource-metrics/process-tree.ts#L153-L215)
- [PR #2483](https://github.com/superset-sh/superset/pull/2483)

It traverses descendants from each terminal root PID and sums CPU and memory for the subtree. Electron processes are measured separately with `app.getAppMetrics()` and grouped into main, renderer, and other.

Sources:

- [`apps/desktop/src/main/lib/resource-metrics/process-tree.ts#L72-L123`](https://github.com/superset-sh/superset/blob/ea15c2189c89873b842bd144523567a21c2a48e3/apps/desktop/src/main/lib/resource-metrics/process-tree.ts#L72-L123)
- [`apps/desktop/src/main/lib/resource-metrics/index.ts#L257-L330`](https://github.com/superset-sh/superset/blob/ea15c2189c89873b842bd144523567a21c2a48e3/apps/desktop/src/main/lib/resource-metrics/index.ts#L257-L330)

On macOS, a small N-API addon calls `proc_pid_rusage(..., RUSAGE_INFO_V4, ...)` and replaces terminal-subtree RSS with `ri_phys_footprint`. This better matches Activity Monitor under compressed-memory pressure. If the addon is unavailable, Superset retains RSS.

Sources:

- [`packages/macos-process-metrics/src/addon.cc#L7-L54`](https://github.com/superset-sh/superset/blob/ea15c2189c89873b842bd144523567a21c2a48e3/packages/macos-process-metrics/src/addon.cc#L7-L54)
- [`apps/desktop/src/main/lib/resource-metrics/process-tree.ts#L125-L149`](https://github.com/superset-sh/superset/blob/ea15c2189c89873b842bd144523567a21c2a48e3/apps/desktop/src/main/lib/resource-metrics/process-tree.ts#L125-L149)

### Demand and cost control

The renderer requests a snapshot every two seconds only while the resource view is mounted. Electron main caches interactive snapshots for 2.5 seconds and coalesces concurrent requests, so repeated callers cannot start duplicate machine-wide scans. An idle cache mode of fifteen seconds exists, but no current caller uses it.

Sources:

- [`apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/TopBar/components/ResourceConsumption/hooks/useResourceSnapshot/useResourceSnapshot.ts#L55-L60`](https://github.com/superset-sh/superset/blob/ea15c2189c89873b842bd144523567a21c2a48e3/apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/TopBar/components/ResourceConsumption/hooks/useResourceSnapshot/useResourceSnapshot.ts#L55-L60), [`#L120-L140`](https://github.com/superset-sh/superset/blob/ea15c2189c89873b842bd144523567a21c2a48e3/apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/TopBar/components/ResourceConsumption/hooks/useResourceSnapshot/useResourceSnapshot.ts#L120-L140)
- [`apps/desktop/src/main/lib/resource-metrics/index.ts#L74-L80`](https://github.com/superset-sh/superset/blob/ea15c2189c89873b842bd144523567a21c2a48e3/apps/desktop/src/main/lib/resource-metrics/index.ts#L74-L80), [`#L192-L235`](https://github.com/superset-sh/superset/blob/ea15c2189c89873b842bd144523567a21c2a48e3/apps/desktop/src/main/lib/resource-metrics/index.ts#L192-L235)

### Limits and a telemetry lesson

Superset's interactive monitor is not a complete process-family monitor:

- it includes Electron processes and terminal-root descendants;
- it does not include host-service or PTY-daemon memory in the displayed total;
- it has no PID start-time identity, so PID reuse is not explicitly guarded;
- it stores only the latest cached snapshots, not historical samples;
- it reports OS memory, not per-process V8 heap details;
- collection work and parsing run under Electron main's lifecycle.

Superset briefly shipped a separate production memory telemetry sampler in [PR #5777](https://github.com/superset-sh/superset/pull/5777). It used `app.getAppMetrics()` and `process.memoryUsage()` every five to six minutes and emitted a privacy-allowlisted PostHog `resource_snapshot`. It was removed one week later in [PR #5964](https://github.com/superset-sh/superset/pull/5964): at partial rollout it produced roughly 500,000 events per day, and full rollout was projected to double total PostHog ingestion because idle desktops emitted on machine cadence rather than user activity.

The lesson for Pie is to keep high-frequency resource samples local and bounded. Remote telemetry should contain low-volume anomaly or release aggregates, not every periodic sample.

## Sidecar versus daemon-owned collection

A sidecar and a daemon can call the same operating-system APIs. The choice changes failure isolation and ownership, not the fundamental visibility of RSS or process trees.

| Concern                                  | Daemon-owned collector                     | Standalone sidecar                                           |
| ---------------------------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| Implementation and packaging             | Simplest; no extra executable or protocol  | Extra process, lifecycle, protocol, and platform artifact    |
| Daemon runtime heap                      | Direct `process.memoryUsage()`             | Not available from OS scans; daemon self-report is separate  |
| Pi descendants                           | Yes, with an OS process-tree scan          | Yes, with an OS process-tree scan                            |
| Electron process classes                 | Electron main can supply PID/type mapping  | Same mapping; unknown descendants stay unclassified          |
| Evidence during daemon event-loop stalls | Sampling may be delayed or stop            | Continues independently                                      |
| Evidence around daemon OOM/crash         | Usually ends with the daemon               | Can preserve pre-exit history and observe termination        |
| Collector CPU/heap overhead              | Charged to the daemon being diagnosed      | Isolated in the monitor process                              |
| CLI and desktop reuse                    | Daemon is already present on both surfaces | Works on both if packaged and launched everywhere            |
| Operational failure modes                | Fewer                                      | Monitor crash/restart and stale-root handling required       |
| Trust boundary                           | Existing daemon privilege                  | No extra visibility unless sidecar gets additional privilege |

Daemon collection is sufficient when the objective is trend detection and local diagnostics under normal operation. A sidecar is justified when monitoring must remain trustworthy specifically while the daemon is unhealthy.

## Comparison

| Capability                                 | T3 Code                               | Superset                                         | OpenCode beta desktop   |
| ------------------------------------------ | ------------------------------------- | ------------------------------------------------ | ----------------------- |
| Production cross-process monitor           | Yes                                   | Partial, interactive                             | No                      |
| Collector location                         | Rust sidecar                          | Electron main                                    | Debug/test surfaces     |
| Electron main/renderer/GPU/utility metrics | Yes, on diagnostics demand            | Main/renderer/other                              | No production collector |
| Daemon/service process included            | Yes                                   | No                                               | No                      |
| Child/provider/terminal attribution        | Yes                                   | Terminal/workspace subtree                       | No                      |
| RSS or working set                         | Yes                                   | Yes; macOS terminal trees use physical footprint | TUI own process only    |
| Runtime heap details                       | No continuous per-process heap detail | No in current monitor                            | Renderer/TUI debug only |
| CPU and I/O                                | CPU and I/O                           | CPU, no I/O                                      | Debug measurements only |
| Adaptive or demand-driven sampling         | Adaptive background/live              | Only while view is open                          | No comparable system    |
| Bounded history                            | Up to one hour, in memory             | Latest cache only                                | TUI 30 seconds          |
| Persistent local telemetry history         | No                                    | No                                               | No                      |
| Hang stack diagnostics                     | Not the focus here                    | Not the focus here                               | Yes, event-triggered    |

## Pie design outcome

The research compares upstream implementations; the normative Pie proposal now lives in [Resource monitoring: independent sampling, separate writers](../design/resource-monitoring.md).

The selected direction is independent sidecar OS sampling, daemon/Electron runtime self-sampling, separate date-named JSONL files, and unchanged business logs. Runtime metrics are not forwarded to a centralized sidecar writer. Paths, ownership, rotation, retention, restart behavior, compatibility, and outstanding approval items are specified in that design rather than duplicated here.
