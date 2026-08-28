# Pie-owned Pi process

> 状态：v1 设计定案。2026-08-27 会话结论：live session 仍是每会话一个子进程；子进程里跑
> `AgentSessionRuntime`；不再 spawn `pi --mode rpc`。JSONL 线协议第一刀不动，对端改成
> pie 维护的 process 入口。`@earendil-works/pi-coding-agent` 继续作为 runtime npm 依赖，
> 不 fork 整包。
>
> 命名：这就是一个子进程，不叫 worker（会让人想到 `worker_threads`）。父进程上的 Effect
> 门面仍叫 `PiProcess`（`process.ts`）。子进程源码放 `process-host/`，避免和 `process.ts`
> 抢 `./process`。
>
> 上游对照：`@earendil-works/pi-coding-agent@0.84.2`（`dist/modes/rpc/rpc-mode.js`、
> `jsonl.js`、`json-event.js`；`createAgentSessionRuntime`）。

## 1. 目标与范围

**目标**：pie 自己启动、杀死、注入 Pi 子进程。父进程继续当 Effect 门面；子进程直接握
`AgentSessionRuntime`，不经过 Pi CLI。

范围内：

- pie 的 process 入口（argv、session 打开、runtime factory、JSONL 循环）
- 从 0.84.2 抽出并维护的宿主代码（见 §3）
- spawn 从 `cli.js --mode rpc` 改到 pie process
- 桌面 asar / CLI 打包打进该入口
- 为注入 `@getpie/pi-loop` 留 `ResourceLoader` 口子

范围外（本期不做）：

- 进程内嵌 `AgentSession`（崩溃隔离要留）
- fork 整份 `pi-coding-agent` 或 `main.ts` CLI
- 改 JSONL 命令/事件形状（`PiProcess` / `transform.ts` / `history.ts` 不动）
- loop 持久化（scheduler 仍在 extension 内存；跨进程恢复另案）
- 双 transport 回退到 PATH 上的 `pi`

## 2. 分层

```
PiAgentSessionService
  PiAgentSessionManager
    PiAgent / PiAgentRuntime          不动
      PiProcess                       不动（turn、steer、队列、崩溃）
        PiTransport                   spawn 目标改掉；帧读写不动
          pie Pi process              每 session 一个 OS 子进程
            AgentSessionRuntime       npm
            pie host（JSONL 循环）    我们维护
```

`AgentSessionRuntime` 过不了进程边界。父进程接到的仍是现在的 `PiProcess` 形状。

子进程 **不是** Effect 程序。SDK 是 Promise 的；Effect 停在 `PiTransport`。

### 2.1 线协议（第一刀冻结）

stdin 命令 / stdout `response` / `extension_ui_*` / `JsonAgentSessionEvent` 与今天
`pi --mode rpc` 相同。类型继续 type-only 从 `@earendil-works/pi-coding-agent` 进
`protocol.ts`。

子进程只实现父进程实际会发的命令：

| 命令                    | 来源                               |
| ----------------------- | ---------------------------------- |
| `get_state`             | handshake + `getModelState`        |
| `prompt`                | `PiProcess.session.prompt`（空闲） |
| `steer`                 | 同，turn 已 Active                 |
| `abort`                 | interrupt                          |
| `get_entries`           | history                            |
| `set_model`             | 模型切换                           |
| `extension_ui_response` | `respondUi`                        |

其余命令回 `success: false`。以后要 `compact` / `fork` 再加，不要预先抄完整
`handleCommand`。

握手不变：spawn 后父进程发 `get_state`，30 秒超时。子进程必须先建好 runtime 再读
stdin。失败：stderr 写原因、非 0 退出，父进程看成 `AgentProcessExited`。

stdout **只**写 JSONL。启动时把 `console.log` / `info` / `warn` 接到 stderr，不抄
`output-guard` 抢 stdout。

## 3. 复制什么

Canonical 落点：`packages/server/src/harness/pi/process-host/`。文件头写
`UPSTREAM @earendil-works/pi-coding-agent@0.84.2` 和源路径。升 npm 版本时对这三处。

| 文件              | 来源                             | 改动                                                                                  |
| ----------------- | -------------------------------- | ------------------------------------------------------------------------------------- |
| `jsonl.ts`        | `dist/modes/rpc/jsonl.js`        | 原样。                                                                                |
| `json-event.ts`   | `dist/modes/json-event.js`       | 原样。                                                                                |
| `output-guard.ts` | `dist/core/output-guard.js`      | 原样。                                                                                |
| `rpc-mode.ts`     | `dist/modes/rpc/rpc-mode.js`     | 原样命令循环 / extension UI / shutdown。import 改到公开包 + 本地 jsonl/output-guard。 |
| `session.ts`      | `main.js` 里 `--session-id` 那段 | 见 §4。                                                                               |
| `main.ts`         | 新写                             | argv、factory，然后 `runRpcMode(runtime)`。                                           |

**不复制**：`main.ts` CLI、TUI、theme JSON、`rpc-client`、print mode、`output-guard`、
`killTrackedDetachedChildren`。关进程靠 `ChildProcessSpawner` 的 `forceKillAfter`
（已是 2s）。

宿主接口（内部 seam，测试打这里，不打真模型）：

```ts
export function runPiProcessHost(input: {
  runtime: AgentSessionRuntime;
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
}): Promise<void>;
```

## 4. Session 打开

今天 create 和 resume 对子进程都是 `--session-id <uuid>`。子进程对齐 Pi CLI：

1. `SessionManager.list(cwd)` 里找相同 id → `SessionManager.open(path)`
2. 找不到 → `SessionManager.create(cwd, undefined, { id })`

`--provider` / `--model` 有则在 factory 里 `session.setModel`（与现在 spawn args
一致）。cwd 用子进程 `process.cwd()`（transport 已经设 spawn cwd）。

## 5. Runtime factory

照 `examples/sdk/13-session-runtime.ts`：

```ts
const createRuntime: CreateAgentSessionRuntimeFactory = async ({
  cwd,
  sessionManager,
  sessionStartEvent,
}) => {
  const services = await createAgentSessionServices({ cwd });
  return {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
    })),
    services,
    diagnostics: services.diagnostics,
  };
};
```

diagnostics 里有 `type: "error"`（含 extension 加载失败）→ stderr + 非 0 退出。
不要后台 `modelRuntime.refresh`（RPC CLI 有；pie 的目录走
`listAvailablePiModels`，已在 server 进程内）。

`bindExtensions` 之后 `runtime.setRebindSession`：`newSession` / `switchSession` /
`fork` 若被 extension 调到，要重新 subscribe。pie 自己不发这些命令。

## 6. Spawn 与可用性

今天 live session 已经是「Node 跑盘上的一个 JS 文件」，不是把 Pi 打进
`server.mjs`：

```
process.execPath  <pi-coding-agent/dist/cli.js>  --mode rpc --session-id …
```

换成 pie process 之后只换入口文件，运行时仍是同一颗 Node（CLI 里是
`node`；桌面里是 Electron Helper + `ELECTRON_RUN_AS_NODE`，现成注释：
daemon 的 `execPath` 会复用给 bundled Pi children）：

```
process.execPath  <pi-process.mjs>  --session-id …
```

`resolvePiExecutable` 默认不再是 `cli.js` / PATH `pi`。

优先级：

1. `PIE_E2E=1` + `PIE_E2E_PI_EXECUTABLE`（只给 **单元测试** 注入假脚本用；桌面 / 多客户端 e2e 不设这项）
2. `PIE_PI_EXECUTABLE`（调试逃生口，可仍指向旧 CLI）
3. pie process：`{ command: process.execPath, prefixArgs: [processPath] }`

`PiTransport` 去掉写死的 `"--mode", "rpc"`。`sessionId` 仍传 `--session-id`。

`processPath` 永远是编出来的 `pi-process.mjs`，不 spawn TypeScript 源：

1. 已经在 `dist/`（bundled `server.mjs` / `cli.mjs`）：同目录的 `pi-process.mjs`
2. 否则：`packages/server/dist/pi-process.mjs`

开发（`pie` bun / vitest）依赖 `@getpie/server#build`，保证该文件在。可用性：stat
该入口。PATH `pi` 不再作为 live session 回退。

## 7. 打包与模块解析

子进程入口 **不要**把 `@earendil-works/pi-coding-agent` 打进 bundle。Pi 自己用
`getPackageDir()` 找 wasm / theme，extension 用 jiti 加载盘上的 `.ts`——打成一坨
以后这些路径全断。这和今天不把 Pi 打进 `server.mjs` 是同一个原因。

### 7.1 导入怎么发生

`pi-process.mjs` 是薄 ESM。tsdown 对 Pi 包 `neverBundle`，发出去的就是裸 specifier：

```js
import {
  createAgentSessionRuntime,
  createAgentSessionServices,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
```

子进程启动后，Node 从 **`pi-process.mjs` 所在目录** 往上走 `node_modules`，解析到已经
安装的包。谁产出这个文件，谁就必须把 Pi 包列成 **runtime 依赖**（`@getpie/server`
和 `@getpie/cli` 现在都有，0.84.2）。

不是 `createRequire` 去拼相对路径，也不是 `NODE_PATH`。就是普通 npm 解析。

| 场景                      | `pi-process.mjs`                                     | Node 找到包的位置                                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 开发 spawn 源码 `main.ts` | `packages/server/src/harness/pi/process-host/`       | `packages/server/node_modules/@earendil-works/pi-coding-agent`（pnpm symlink）                                                                                                      |
| server 产物               | `packages/server/dist/pi-process.mjs`                | 同上，从 `dist/` 再往上一级                                                                                                                                                         |
| `pie` CLI 产物            | `packages/pie/dist/pi-process.mjs`                   | `@getpie/cli` 的依赖；全局安装时在 `node_modules/@earendil-works/pi-coding-agent`（与 `@getpie/cli` 同级或嵌在 cli 自己的 node_modules）                                            |
| 桌面                      | asar 解出来的 `…/@getpie/server/dist/pi-process.mjs` | 同树的 `node_modules/@earendil-works/pi-coding-agent`。子进程的 `execPath` 是 Electron-as-node，能读 asar 里的 JS；`dist/**` 继续 unpack，因为 wasm / 被 spawn 的文件必须是真实路径 |

拷走一个孤零零的 `pi-process.mjs`、旁边没有 `node_modules`，启动会 `ERR_MODULE_NOT_FOUND`。这是预期，不是漏了打包步骤。

### 7.2 tsdown

`packages/server/tsdown.config.ts` 增加入口：

```ts
entry: {
  server: "src/http/main.ts",
  "pi-process": "src/harness/pi/process-host/main.ts",
}
```

`pi-process` 的 `neverBundle` 含 `@earendil-works/pi-coding-agent`（及它的
`@earendil-works/pi-*`）。`server.mjs` 现有 alwaysBundle 不变——server 进程仍然
self-contained；只有 **子进程** 在运行时解析 Pi。

`packages/pie` 的 CLI 把 server 编进 `cli.mjs`，runtime 没有 `@getpie/server`
包。pie tsdown 增加同一 process 源的第二入口，输出 `dist/pi-process.mjs`。CLI
已经依赖 Pi 包，和今天 `resolveBundledPiCli()` 能从 `cli.mjs` 里
`import.meta.resolve` 到 `cli.js` 是同一条图。

桌面：

- `asarUnpack` 继续解 `**/node_modules/@earendil-works/pi-coding-agent/dist/**`
- 另解 `**/node_modules/@getpie/server/dist/pi-process.mjs`（spawn 目标必须是真实文件；asar 里的路径不能当 `execPath` 的脚本参数交给非 Electron 的 Node，桌面这条路径用的是 Electron Helper，仍以真实文件为稳）
- 注释从 `node <cli.js> --mode rpc` 改成 `node <pi-process.mjs>`

`@getpie/pi-loop` 若要在桌面注入，必须是盘上真实文件（jiti），asarUnpack 它的
`src/**`。v1 可以不注入，但路径解析要一次写对。

## 8. Extension 注入（v1 口子，v2 打开）

v1：不传 `additionalExtensionPaths`，行为与现在的 RPC 子进程对齐（仍加载用户
`~/.pi/agent/extensions` 和项目 `.pi/extensions`）。`pieExtensionPaths()` 等
PR 3 注入 `@getpie/pi-loop` 时再加。

v2：解析 `@getpie/pi-loop` 的 package 根，把
`package.json#pi.extensions`（`./src/index.ts`）加进
`additionalExtensionPaths`。不走 `-e`。

loop 仍然随子进程退出而消失。要跨重启，另案写 session metadata / `appendEntry`。

## 9. 测试与验证

**凡是在证明「pie 子进程在跑 Pi」的，都走真实 `pi-process` + 真实模型。** 不再用
`tools/testing/fake-pi.mjs` 充当 agent。没有 Pi auth 就 skip，不降级成假进程。

假脚本只留给测 pie **自己的** 帧/状态机（JSONL 拆帧、`PiTransport` 相关、
`PiProcess` turn 队列）。那些测试注入 `executable: { command: fake.js }`，不设
`PIE_E2E_PI_EXECUTABLE`，也不经过 LLM。

Pi 凭证读 `getAgentDir()`（默认 `~/.pi/agent`），不要指到 e2e 的隔离
`$PIE_HOME`。`$PIE_HOME` 只隔离 pie 的 project/session 元数据。

### 9.1 适配器单元测试（无模型，CI 必跑）

`turbo run test --filter=@getpie/server`

| 测什么         | 怎么测                                                  | 通过标准                                                   |
| -------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| JSONL 分帧     | 纯函数，往 reader 喂含 U+2028 的 JSON + `\n`            | 不断行；一条 record                                        |
| `toJsonEvent`  | 带 `partial` / cumulative `message` 的 `message_update` | 发出去的帧没有这两项                                       |
| 命令循环       | `runPiProcessHost({ runtime: fake, stdin, stdout })`    | 见下                                                       |
| Session 打开   | 真 `SessionManager` + `fs.mkdtemp`                      | 同 id 第二次是 open 不是 create                            |
| 解析入口       | `resolvePiExecutable({})`                               | 指向 `dist/pi-process.mjs`，不是 `cli.js` / 源码 `main.ts` |
| transport argv | 注入假可执行文件                                        | 有 `--session-id`，没有 `--mode rpc`                       |

Host fake runtime：`get_state` 相关、`prompt` 异步 success、未知命令失败、
`extension_ui_response` 唤醒 pending、stdin end 调 `dispose`、stdout 只有 JSONL。

加载检查（仍无 prompt）：spawn 入口不传 `--session-id`。
`ERR_MODULE_NOT_FOUND` 为失败；usage 非 0 为通过。PR 2 之后对
`dist/pi-process.mjs` 再跑，并 grep 产物里的
`"@earendil-works/pi-coding-agent"`，确认没被 bundle。

### 9.2 真模型（有 auth 就跑，无 auth 则 skip）

Auth：环境变量或 `~/.pi/agent/auth.json`。探测失败 → `it.skip` / Playwright skip，
并写明原因。超时按 turn 至少 120s。

**Server smoke**（现有 `agent.smoke.test.ts`，切 spawn 后自动打到 `pi-process.mjs`）：

```
turbo run test --filter=@getpie/server --force
```

create + prompt `"Reply with exactly: PONG"`，要有 assistant text-delta 和 `finish`。
不再需要 `PI_SMOKE=1` 开关：有凭证就跑。

**桌面 e2e**：`apps/desktop/e2e` 的 fixture **去掉** `PIE_E2E_PI_EXECUTABLE` /
`PIE_E2E_PI_RESPONSE` / `PIE_E2E_PI_LOG`。保留 `PIE_E2E=1`（macOS accessory
policy、自带 `--user-data-dir`）。默认入口即 `pi-process.mjs`。

- `/draft` 发一条短 prompt，transcript 出现模型回复（不是写死的 "Desktop fake Pi reply"）
- `ps`：该次 turn 的子进程命令行含 `pi-process.mjs`，不含 `cli.js`、不含 `fake-pi.mjs`
- 无 auth → skip 整份 Electron launch

```
pnpm turbo run e2e --filter=@getpie/desktop
```

（桌面 e2e 本就不在 CI。）

**多客户端**（`multi-client-sync.spec.ts`）：同样不注入 fake-pi。断言从
`FAKE_REPLY` 改成「assistant 文本出现并在两个 page 上同步」。history 回填若仍未
做，继续只断言 live/snapshot 看见的 turn，但内容来自真模型。

**手工 UI**：`.agents/skills/verify`（vite 4190 + `pie dev` 4180），`/draft`
发一条，确认流式输出。

### 9.3 PR 对测试的切分

| PR         | 适配器（CI）                                   | 真模型                                                    |
| ---------- | ---------------------------------------------- | --------------------------------------------------------- |
| 1 宿主     | host/jsonl/session；源码入口 usage spawn       | smoke 仍走旧 `cli.js`，证明没回归                         |
| 2 切 spawn | resolve + transport argv；现有注入假脚本的套件 | smoke + 桌面 e2e + multi-client，全部打 `pi-process.mjs`  |
| 3 pi-loop  | fake loader 收到 `additionalExtensionPaths`    | 真 session 里 `/loop` 出现在 `get_commands`，UI 能建 loop |

## 10. 文档与规则

落地时改这些说法（现在都写着 `pi --mode rpc`）：

- `CONTEXT.md` `PiAgentRuntime / PiProcess`
- `.claude/rules/architecture.md`（及 `.agents/rules` 副本若有）
- `packages/server/src/harness/pi/protocol.ts`、`process.ts`、`transport.ts` 顶注
- `apps/desktop/electron-builder.yml` 注释
- ADR 0003 里「probe of `pi --mode rpc`」可留作历史，不必改结论

## Key Decisions

1. **子进程 + SDK，不走 CLI。** 崩溃隔离留着；启动参数、extension 集合、生命周期归 pie。
2. **Runtime 用 npm，宿主 pie 维护。** fork 整包会拖进 TUI/CLI。漂移点只在 jsonl / 事件形状 / 那几个命令。
3. **第一刀线协议不动。** `PiProcess`、transform、history 已按这套帧工作。改协议是后续 PR，不是本切的一部分。
4. **只实现父进程会发的命令。** 完整抄 `rpc-mode` 会连上 theme / stdout takeover / 一堆 pie 不用的命令。
5. **子进程入口不 bundle Pi。** `getPackageDir`、wasm、jiti 加载 extension 都要真实文件。
6. **去掉 PATH `pi` 回退。** live session 的运行时是 pie process + npm。`PIE_PI_EXECUTABLE` 留下给调试。
7. **pi-loop 不绑 v1。** 先做 drop-in 替换，再打开 `additionalExtensionPaths`。
8. **不叫 worker。** 源码目录 `process-host/`，产物 `pi-process.mjs`，避免和门面 `process.ts` 冲突。
9. **验证走真模型。** 桌面 e2e、多客户端、server smoke 都 spawn 真 `pi-process`、打真 LLM。假脚本只测 pie 自己的帧和 turn 状态机。无 auth 就 skip，不回退 fake-pi。

## 否决

| 方案                          | 原因                                                                  |
| ----------------------------- | --------------------------------------------------------------------- |
| 进程内 `AgentSession`         | 一个 session 崩掉整个 daemon / 桌面所有会话                           |
| 父进程调 `runRpcMode`         | 那是 CLI 循环：`process.exit`、抢 stdout、SIGTERM；pie 不拥有启动路径 |
| 整包 vendor `pi-coding-agent` | TUI、migrations、package manager pie 不用                             |
| 原样复制 `rpc-mode.ts`        | 粘 theme / output-guard；命令面比父进程大一圈                         |
| 第一刀就改 JSONL              | 无收益，transform/history 全要动                                      |
| `worker_threads`              | 隔离不到 native crash 和独立 RSS；bash 子进程仍共享寿命               |

## PR Plan

### PR 1 — Process 宿主（不切 spawn）

**标题：** `feat(server): add pie-owned Pi process host`

**文件：** `packages/server/src/harness/pi/process-host/{jsonl,json-event,ui-context,host,session,main}.ts` 及对应 `packages/server/test/harness/pi/process-host/`

**依赖：** 无

**内容：** 抽出 jsonl / toJsonEvent / 精简 host；`runPiProcessHost` 用 fake runtime 测通。不改 `resolvePiExecutable`。可在本地 `node main.ts --session-id …` 对真 Pi 做 handshake，不进默认 CI。

### PR 2 — 打包并切换 spawn

**标题：** `feat(server): spawn pie Pi process instead of pi --mode rpc`

**文件：** `tsdown.config.ts`（server + pie）、`resolve-executable.ts`、`transport.ts`、`electron-builder.yml`、resolve/transport 测试、CONTEXT.md / architecture 注释

**依赖：** PR 1

**内容：** 产出 `dist/pi-process.mjs`（Pi 包 external）。默认 spawn 该入口，去掉 `--mode rpc`。E2E 假可执行文件路径不变。合并后 live session 不再启动 `cli.js`。

### PR 3 — 注入 `@getpie/pi-loop`

**标题：** `feat(server): load @getpie/pi-loop in the Pi process`

**文件：** process-host factory 的 `pieExtensionPaths()`、桌面 asarUnpack `pi-loop`、pi-loop README（不再要求手写 `-e`）

**依赖：** PR 2

**内容：** `additionalExtensionPaths` 指向 package 里声明的 extension。`/loop` 出现在 Server Pi。不引入持久化。
