---
status: pending
priority: p2
issue_id: "022"
tags: [effect, architecture, code-review, observability, testing]
dependencies: []
---

# Effect 用法审计：偏离 Effect 4 心智模型的 28 项问题与修复方案

## Problem Statement

以仓库实际安装的 Effect `4.0.0-rc.112` 自带的 `ai-docs`（`node_modules/.pnpm/effect@4.0.0-rc.112/node_modules/effect/ai-docs/src/`）和 `.agents/rules/stack.md` 为基准，对 `packages/server`、`packages/effect-json-store`、`packages/pie`、`packages/contract`、`apps/desktop` 做了一次 Effect 用法审计。

骨架是对的：`Context.Service` + 手写 `Layer`、`Scope`/`acquireRelease`、`forkIn`/`forkScoped` 结构化并发、`@effect/vitest` + `TestClock`、`effect/unstable/cli` 的 `Command.make` + `NodeRuntime.runMain`。没有发现会导致资源泄漏或死锁的结构性错误。

偏离集中在"边缘"：函数定义风格、错误类型、配置读取、少数 fire-and-forget、错误日志丢信息、以及一批手写轮子。下面按优先级逐条列出现状、问题和方案。每条都可以独立成 PR；末尾给出建议的切片顺序。

统计口径均排除 `*.test.ts`，除非注明。

## Findings

### 一、高优先级

#### 1. `Effect.fn` 零使用，全部是 `Effect.gen`

**现状**：`Effect.fn(` 0 次；`Effect.gen(function*` 153 次；`=> Effect.gen(` 202 次。`Effect.withSpan` 只有 5 处，几乎所有 tracing 靠 `packages/server/src/rpc/handlers.ts` 的 `makeRpcWrap` 在 RPC 入口统一打，服务内部方法没有 span。

**问题**：文档（`01_effect/01_basics/index.md`）明确写 "Prefer writing Effect code with `Effect.gen` & `Effect.fn("name")`"。`Effect.fn("name")` 会自动创建同名 span、把调用栈挂到错误上、并允许在第二个参数位直接接 combinator。全用匿名 `Effect.gen` 意味着 trace 和错误栈里只有 RPC 入口一层名字。

**方案**：服务 shape 的每个方法实现从

```ts
create: (input) => Effect.gen(function* () { ... })
```

改为

```ts
create: Effect.fn("PiAgentSessionService.create")(function* (input) { ... })
```

需要 `mapError`/`withSpan` 等附加行为的，放在 `Effect.fn` 的第二个参数位（参考 `03_services/20_layer-composition.ts` 中 `Effect.fn("UserRepository.findById")(function*(id) {...}, Effect.mapError(...))`）。纯机械改动，按 package 切 PR。

#### 2. 错误类型分裂：`Data.TaggedError` 53 处 vs `Schema.TaggedError` 14 处

**现状**：

- `packages/server/src/harness/errors.ts`：13 个全部 `Schema.TaggedError`，`cause: Schema.Defect()`。
- `packages/server/src/errors.ts`、`daemon/errors.ts`、`pull-request/errors.ts`、`http/server.ts:45`、`pull-request/github-cli.ts:83–89`、`packages/effect-json-store/src/errors.ts`、`apps/desktop/src/main/server/local-server.ts:27–40`、`apps/desktop/src/main/electron/app-protocol.ts:12`：全部 `Data.TaggedError`，`cause: unknown`。
- 另有两个裸 `Error` 子类：`schedule/cron.ts:6` 的 `CronError`、`pull-request/normalization.ts:13` 的 `InvalidPullRequestJsonError`，以 throw 形式进入 Effect，只能变成 defect。

**问题**：Effect 4 文档中的错误示例都是 `Schema.TaggedError`，因为错误要跨序列化边界流动。本项目正好是 oRPC over WebSocket、`@getpie/contract` 已经是 Effect Schema，但 `Data.TaggedError` 的错误到了 `packages/server/src/rpc/session.ts` 284–298 行只能 `e.message` 拍扁后塞进 `errors.INTERNAL(...)`，一长串手写 `catchTags` 映射表。

**方案**：

1. 统一为 `Schema.TaggedError<Self>()("Tag", { ..., cause: Schema.Defect() })`。
2. `CronError`、`InvalidPullRequestJsonError` 改成 tagged error，调用处用 `Effect.try({ try, catch })` 接住。
3. 之后 `packages/contract` 可以直接复用这些 error schema，RPC 端的 tag → oRPC error 映射表可以收敛为一个 `Schema.Union` 的解码。

#### 3. 配置全部走 `process.env`，`Config` 模块零使用

**现状**：`process.env.*` 11 处，`Config.*` / `Context.Reference` 0 处。

- `packages/server/src/http/serve.ts:19–33,133,137`：`PIE_AUTH_TOKEN`（读完还 `delete process.env.PIE_AUTH_TOKEN`）、`PIE_PORT`、`NODE_ENV`、`PIE_DAEMON_COMPATIBILITY_KEY`、`npm_package_version`。
- `packages/server/src/observability/logging.ts:73,85`：手动解析 `PIE_LOG_LEVEL`、`PIE_PRINT_LOGS`。
- `packages/server/src/harness/pi/resolve-executable.ts:34–41`：`PIE_E2E`、`PIE_PI_EXECUTABLE`。
- `apps/desktop/src/main/desktop-runtime.ts:52,57,106`、`main-window.ts:40`、`login-shell-environment.ts:108–109`、`local-server-live.ts:19`。

**问题**：违反 `.agents/rules/stack.md` "side effects go through Effect's platform services"。测试只能靠改真实环境变量注入；token 不 redact；缺少类型化的默认值和错误报告。

**方案**：

- `Config.redacted("PIE_AUTH_TOKEN")`（自动 redact，不需要 `delete process.env`）。
- `Config.integer("PIE_PORT").pipe(Config.withDefault(4180))`、`Config.logLevel("PIE_LOG_LEVEL")`。
- 有默认值的开关用 `Context.Reference<boolean>("pie/PrintLogs", { defaultValue: () => false })`（`03_services/10_reference.ts`）。
- 测试用 `ConfigProvider.fromMap` 注入。
- Electron Main 属于 `stack.md` 里的豁免范围，但 `login-shell-environment.ts` 这类纯逻辑仍建议接受 `Config`。

#### 4. 三处 `Effect.forkDetach` 脱离监督

**现状**：

- `packages/server/src/harness/session-service.ts:482`：idle prompt 投递。
- `packages/server/src/schedule/fire.ts:214`：`settleAfterPrompt` fire-and-forget。
- `apps/desktop/src/main/electron/main-window.ts:118`：`loadURL` 失败后 `catchCause` + `forkDetach`。

**问题**：`forkDetach` 的 fiber 不属于任何 Scope，父 Scope 关闭时不会被中断，defect 无人观察，进程退出时这些 fiber 只是消失。项目其他地方（`harness/pi/process.ts`、`harness/pi/runtime.ts`、`harness/session.ts`）都正确用了 `forkIn(scope)`，这三处是漏网的。

**方案**：改为 `Effect.forkIn(ownerScope)` 或 `Effect.forkScoped`；确实需要跨请求存活的，用 `FiberSet.run` 挂到服务级 scope，保证 shutdown 时能中断、defect 能被记录。`main-window.ts` 的那处应挂到 window 的 Scope 上（同一文件 105 行已经有 `addFinalizer`）。

#### 5. 日志把错误 `String()` 掉，`Effect.catch` 漏掉 defect

**现状**：`packages/server/src/schedule/daemon.ts:14–39`

```ts
Effect.catch((error) =>
  Effect.logWarning("schedule tick failed").pipe(
    Effect.annotateLogs({ event: "schedule.tick_failed", error: String(error) }),
```

**问题**：

- `Effect.log*` 支持直接传 error 作为参数（`08_observability/10_logging.ts`），logger 会渲染完整 Cause；`String(error)` 对 `TaggedError` 只剩 message。
- `Effect.catch` 只捕获 typed failure。`tick()` 内若出现 defect（例如 `schedule/tick.ts` 对 `schedule.nextRunAt!` 的非空断言炸掉），`Effect.forever` 直接终止，schedule daemon 静默死亡。而 `ScheduleDaemonLayer`（`rpc/runtime.ts:88`）是 `Layer.effectDiscard(... forkScoped)`，无人察觉。
- 同类：`schedule/runtime.ts` 对 `PlatformError` 直接 `Effect.die`。

**方案**：永活循环用 `Effect.catchCause` 兜底并 `Effect.logWarning("schedule tick failed", cause)`；或把循环体包成 `Effect.retry(Schedule.spaced(...))`。`Effect.sleep(\`${ms} millis\`)`改为`Effect.sleep(Duration.millis(ms))`。

### 二、中优先级

#### 6. Service 标识符无命名空间

**现状**：server 侧全部裸名：`"EventBus"`、`"PiAgent"`、`"PiProcess"`、`"Paths"`、`"GitService"`、`"ScheduleService"`……desktop 侧已经是 `"desktop/MainWindow"`、`"desktop/LocalServer"`。

**问题**：文档约定 `"myapp/UserRepository"`。裸名在 Context 里靠字符串区分，两个包各定义一个 `"Paths"` 会静默覆盖。

**方案**：统一为 `"pie/EventBus"` 前缀。与第 7 条合并做。

#### 7. Layer 挂在类外而不是 `static layer`

**现状**：23 个 `export const XxxLayer`，0 个 `static readonly layer`。`rpc/runtime.ts:24` 为此专门造了一个 `PiProcessTag` 类与 `PiProcess` 类型分家。

**问题**：文档模式是 `layer` / `layerNoDeps` 作为 service 类的静态成员（`20_layer-composition.ts`），import 一个符号同时拿到 tag 和实现。

**方案**：

```ts
export class GitService extends Context.Service<GitService, GitServiceShape>()("pie/GitService") {
  static readonly layerNoDeps = Layer.effect(this, make);
  static readonly layer = this.layerNoDeps.pipe(Layer.provide(PlatformLayer));
}
```

旧的 `XxxLayer` 导出可先保留为别名，逐步删除。

#### 8. `rpc/runtime.ts` 组合根冗长

**现状**：79 处 `Layer.provide` vs 3 处 `Layer.provideMerge`。`packages/server/src/rpc/runtime.ts` 每个 `XxxProvided` 都重复 `Layer.provide(PlatformLayer)`、`Layer.provide(PathsLayer)`。30 行 `const piExecutable = resolvePiExecutable()` 在模块顶层同步执行。

**问题**：Layer 按引用 memoize，功能没问题，但可读性差、容易漏；模块顶层副作用在 import 时执行，测试无法替换。

**方案**：分层

```ts
const Infra = Layer.mergeAll(PlatformLayer, PathsLayer, EventBusLayer);
const Domain = Layer.mergeAll(GitService.layerNoDeps, WorktreeService.layerNoDeps, ProjectService.layerNoDeps, ...)
  .pipe(Layer.provideMerge(Infra));
const Harness = Layer.mergeAll(PiAgent.layerNoDeps, PiAgentSessionService.layerNoDeps, ...)
  .pipe(Layer.provideMerge(Domain));
export const AgentRuntimeLayer = Layer.mergeAll(Harness, ScheduleDaemonLayer, NodeHttpPlatform.layer);
```

`resolvePiExecutable()` 移入 `Layer.sync` / `Layer.effect`。

#### 9. `PiAgentShape` 泄漏 `R` 且可变

**现状**：`packages/server/src/harness/pi/agent.ts:20–33` shape 方法的 `R` 含 `FileSystem.FileSystem`；78–80 行 `cachePiAgentAvailability` 通过 `(pi as MutableAvailability).availability = ...` 就地改写服务对象。

**问题**：违反 `stack.md` "R-free service shapes"；服务对象事后 mutate 不符合 Effect 的不可变约定。

**方案**：在 `Layer.effect` 构造时 `const fs = yield* FileSystem.FileSystem` 后闭包捕获，shape 里 `R = never`；availability 缓存在构造阶段 `const availability = yield* Effect.cached(check)` 一次完成，删掉 `MutableAvailability`。

#### 10. `ScheduleService` 用冻结 Context + 强转绕过 `R`

**现状**：`packages/server/src/schedule/service.ts:66–74`

```ts
const env = Context.make(ScheduleRepository, repo).pipe(Context.add(ProjectService, projects), ...);
const provide = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E> =>
  effect.pipe(Effect.provide(env)) as Effect.Effect<A, E>;
```

**问题**：其他服务都是 `yield* Dep` 后闭包捕获，这里手动组 Context 再 `as` 强转，类型系统不再校验依赖是否齐全。

**方案**：`tick`/`fire`/`settle` 等函数改为接受显式依赖参数（或直接在 `Layer.effect` 内闭包捕获），删掉 `provide` 与强转。

#### 11. 手写 Scope 生命周期

**现状**：`packages/server/src/rpc/session-stream.ts:16–20`

```ts
const subscriptionScope = yield * Scope.make();
const stream = bus.subscribe(scope).pipe(Effect.provideService(Scope.Scope, subscriptionScope));
return stream.pipe(Stream.ensuring(Scope.close(subscriptionScope, Exit.void)));
```

`http/server.ts:249–252` 的 `Scope.makeUnsafe()` + `acquireRelease` 类似。

**问题**：手动复刻 `Stream.unwrapScoped`，且始终以 `Exit.void` 关闭，finalizer 无法区分正常结束与中断/失败。

**方案**：`session-stream.ts` 改为 `Stream.unwrapScoped(bus.subscribe(scope))`。`http/server.ts` 那处有请求 fiber 跨阶段的合理理由，可保留但补注释说明为什么不能用 `Layer.scoped`。

#### 12. 手写类型守卫，`Predicate` 模块零使用

**现状**：`harness/pi/transport.ts:54`、`harness/pi/process.ts:456`、`harness/errors.ts:7`、`harness/pi/transform.ts:46–49`、`harness/session-fold.ts:47–49`、`observability/logging.ts` 的 `plain` 函数，都是 `typeof x === "object" && x !== null && "_tag" in x` 一类。

**问题**：`10_predicate/index.md` 原文 "**NEVER** write your own helper functions like `isRecord` or `isString`, instead use the helpers from the `Predicate` module."

**方案**：`Predicate.hasProperty(x, "_tag")`、`Predicate.isTagged(x, "Foo")`、`Predicate.isRecord`、`Predicate.isString`。

#### 13. 错误吞噬：匿名 `Effect.catch(() => Effect.void / Effect.succeed(x))` 约 20 处

**现状**：

- `events/event-bus.ts:70,104`：包在 `SynchronizedRef.modifyEffect` 外，把 Queue 操作失败和 modify 本身失败一起吞掉。
- `harness/pi/process.ts:382,475,643`、`harness/pi/runtime.ts:167,169`：abort/shutdown 路径。
- `git/service.ts:171,303`：git 命令失败变成 `""`。
- `fs/service.ts:153,156,198,227`、`rpc/fs.ts:71`、`harness/executable.ts:52`。
- `apps/desktop/src/main/server/login-shell-environment.ts:54`：probe 失败变 `undefined`。
- `pull-request/github-cli.ts:252–284`：`mapError` / `catch: () => new PullRequestInvalidResponse()` 把 IO、超时、JSON 解析失败压成无 `cause` 的 tag。
- `rpc/fs.ts:62`：`mapError(() => errors.READ_FAILED(...))` 丢掉 FS cause。

**问题**：清理路径上的 best-effort 可以吞，但匿名 `() => Effect.void` 不区分"预期的失败"和"未预期的失败"，且丢掉诊断信息。

**方案**：

- 一律显式 `Effect.catchTag("XxxError", ...)`；真正可忽略的用 `Effect.ignore`（意图明确）或 `Effect.ignoreLogged`。
- `mapError` 一律保留 `cause`（配合第 2 条的 `Schema.Defect()`）。
- `event-bus.ts` 两处拆开：`Queue.offer` 的失败单独处理，不要包住 `modifyEffect`。

#### 14. `Semaphore.makeUnsafe` / `Deferred.makeUnsafe` 在 Effect 内部使用

**现状**：`harness/session.ts:147,348`、`harness/session-manager.ts:245`、`schedule/runtime.ts:19–20`、`effect-json-store/src/collection.ts:130–141`（mutable `Map<string, Semaphore>` + `makeUnsafe`）。

**问题**：`*Unsafe` 构造器是给 Effect 外部（模块顶层、测试）用的；在 `Effect.gen` 里应该 `yield* Semaphore.make(1)` / `yield* Deferred.make()`。

**方案**：改用 effectful 构造器。`collection.ts` 的按 id 锁可以换成 `Semaphore` 的 `Map` 放进 `Ref`/`SynchronizedRef`，或者直接用 `Effect.unstable` 里的 `PartitionedSemaphore`（若该版本存在）。

#### 15. `schedule/runtime.ts` 跨 fiber 共享的可变 `Set`

**现状**：`packages/server/src/schedule/runtime.ts:16–21`

```ts
Layer.sync(ScheduleRuntime, () => ({
  inFlight: new Set<string>(),
  tickGate: Semaphore.makeUnsafe(1),
}));
```

`schedule/fire.ts:234–248` 在多个 fiber 中 `inFlight.has/add`，`settle.ts:146–149` 在 `ensuring` 里 `delete`。

**问题**：跨 fiber 共享状态应该用 `Ref`/`SynchronizedRef`，否则与第 4 条的 `forkDetach` 叠加时，中断语义和竞态很难推理。

**方案**：`inFlight: Ref<HashSet<string>>` 或直接用 `FiberMap<string>`（按 schedule id 管理 fiber，天然去重 + 可中断）。

#### 16. `EventBus` 用 `Ref<Map>` + `Queue.dropping` 手写发布订阅

**现状**：`packages/server/src/events/event-bus.ts:48–153` 自建订阅者表、每订阅者一个 `Queue.dropping(capacity+1)`、`SynchronizedRef` 状态机、慢消费者驱逐。`PubSub` 零使用。

**问题**：Effect 有 `PubSub.bounded/dropping/sliding` + `Stream.fromPubSub`（`07_pubsub/10_pubsub.ts`）。"驱逐并通知 `closed: slow_consumer`" 这一语义 PubSub 原生没有，所以手写有理由。

**方案**：属于"值得讨论"而非必改。可以先把订阅表和广播换成 `PubSub`，只把驱逐逻辑留在外层；单独开设计讨论，不并入其他 PR。

#### 17. `http/server.ts` 的 Promise 组合缝

**现状**：进程入口是 `NodeRuntime.runMain`（`http/main.ts:19–23`），但 `createServer`（`server.ts:282–299`）降到 Promise + `Scope.makeUnsafe` + `Effect.runPromiseWith`，内部各阶段用 `Effect.promise`（`server.ts:202,239,240,245,253`）。

**问题**：`Effect.promise` 把 rejection 变成 defect，上层无法 `catchTag`。`createRpcRuntime`、`createUI`、`createRequestHandler` 若失败（端口占用、UI 资源缺失），会以 defect 而非 `ServerStartupError` 出现。

**方案**：

- 可预期的失败用 `Effect.tryPromise({ try, catch: (e) => new ServerStartupError({ phase: "create", cause: e }) })`。
- `closeWiredServer` 在 finalizer 里用 `Effect.promise` 可以接受。
- 长期：`createServer` 改为返回 `Layer<Server, ServerStartupError, Scope>`，Promise 包装只留给 `apps/desktop` 一个调用点。

### 三、低优先级 / 一致性

#### 18. 时间：`new Date()` / `Date.now()` 30 处 vs `Clock` / `DateTime` 16 处

**现状**：

- `harness/session-service.ts:334`、`project/service.ts:81`：`createdAt: new Date().toISOString()`，`TestClock` 管不到。`schedule/settle.ts:50` 已经是 `Clock.currentTimeMillis` 的正确写法。
- `schedule/cron.ts`：大量 `new Date(ms)` + `Intl.DateTimeFormat` 做日历算术。
- `daemon/lock.ts:22,31,63`：`Date.now()` + `setTimeout` 轮询锁。
- `apps/desktop/src/main/desktop-runtime-glue.ts:22`：`setTimeout(() => app.quit(), 0)`。

**方案**：

- 取当前时间统一 `yield* Clock.currentTimeMillis` 或 `yield* DateTime.now`。
- `cron.ts` 用 `DateTime.make` / `DateTime.startOf` / `DateTime.setZone`（`07_datetime/`）；如果 Effect 4 的 `Cron` 模块能覆盖需求，直接用 `Cron.parse` + `Cron.next`。
- `daemon/lock.ts` 轮询改为 `Effect.retry(Schedule.spaced(...).pipe(Schedule.upTo(...)))`。
- `desktop-runtime-glue.ts` 改为 `Effect.yieldNow` 后 `Effect.sync(() => app.quit())`。

#### 19. 随机源绕过 `Crypto` 服务

**现状**：`harness/pi/process.ts:10` `import { v7 as uuid } from "uuid"`（501、518 行调用）；`effect-json-store/src/atomic.ts:24` `crypto.randomUUID()`。而 `schedule/service.ts:62` 已经正确地 `yield* Crypto.Crypto`。

**方案**：统一 `yield* Crypto.Crypto` 后调用 `crypto.randomUUID`；若必须 UUID v7（时间有序），在 `Crypto` 之上封一个 `pie/IdGenerator` 服务，测试可确定性注入。

#### 20. 手写 `drainQueue`

**现状**：`packages/server/src/harness/queue-stream.ts` 用 `Queue.takeUnsafe` 循环清空队列。

**方案**：`Queue.takeAll` / `Queue.clear`。

#### 21. `rpc/stream.ts` 的包装多余

**现状**：`streamToAsyncGenerator` 只是 `yield* Stream.toAsyncIterable(stream)`。

**方案**：直接在调用点用 `Stream.toAsyncIterable`；将来需要带 context 时改用 `Stream.toAsyncIterableEffect`（`R` 会保留在返回的 Effect 上）。

#### 22. `session-manager.ts` 的 lazy-open 用 `Ref` + `Semaphore` 两件套

**现状**：手写"首次打开、并发去重"。

**说明**：`Effect.cached` 会连失败一起缓存，若需要"失败后允许重试"，现有实现是合理的。

**方案**：合并为单个 `SynchronizedRef.modifyEffect`，去掉 `Ref` + `Semaphore` 双结构。

#### 23. `harness/pi/transport.ts:164–171` 在 `Effect.gen` 里 `try/catch` `JSON.parse`

**说明**：注释已说明 stdout 有非 JSON 行需要跳过，属于有意为之。

**方案**：改为 `Effect.try({ try: () => JSON.parse(line), catch: () => new PiProtocolNoise() }).pipe(Effect.option)`，或直接 `Schema.decodeUnknownOption(Schema.parseJson(FrameSchema))`，让"跳过"变成类型可见的 `Option.none`。

#### 24. `packages/pie/src/node/cli.ts:52–78` 用 `console.log`

**方案**：CLI 用户可见输出走 `Console.log`（Effect 的 `Console` 服务，可在测试中替换），诊断日志走 `Effect.log*`。`http/serve.ts:187–188` 的 ready line 是协议握手，保留 stdout 但同样建议走 `Console.log`。

#### 25. `apps/desktop/src/main/electron/renderer-channel.ts:17–36` MessagePort 生命周期不在 Scope 内

**现状**：创建/关闭走 Promise + `try/catch`，错误在 Effect 外 rethrow。

**方案**：`Effect.acquireRelease(Effect.sync(() => new MessageChannelMain()), (ch) => Effect.sync(() => { ch.port1.close(); ch.port2.close(); }))`，与 `main-window.ts:105` 的 window finalizer 放到同一个 Scope。

### 四、测试侧

#### 26. `harness/session-service` 测试套件在普通 vitest 下跑，真实 sleep

**现状**：`packages/server/test/harness/session-service-fixture.ts:116` 每次调用 `Effect.runPromise` 重建 Layer；`session-service.test.ts:129,327,356,365,…,1019`、`session-service-worktree.test.ts:58,104` 用真实 `Effect.sleep("50 millis")` / `"80 millis"` 等待。`TestClock` 的 54 处全部集中在 `schedule/service.test.ts`。

**方案**：迁到 `layer(NodePlatformLayer)("session-service", (it) => it.effect(...))`，等待用 `TestClock.adjust`；fixture 的 `run` 改为只 `Effect.provide`，不 `runPromise`（`session.test.ts:67–68` 已经是这个写法）。

#### 27. desktop / daemon 测试用 `expect(Effect.runPromise(...)).resolves`

**现状**：`apps/desktop/src/main/server/local-server.test.ts`（约 30 处 `runPromise`）、`desktop-application.test.ts`、`desktop-rpc-server.test.ts`、`packages/server/test/daemon/liveness.test.ts:40`。

**方案**：改用 `it.effect` + `Effect.exit` / `Effect.flip` 断言；`ManagedRuntime` 只在 `rpc-harness.ts` 保留一份，`rpc-session.test.ts:130–132` 的重复删掉。

#### 28. 手动 `mkdtemp` + `afterEach(rm)` 而不是 scoped 临时目录

**现状**：`session-repository.test.ts:36–40`、`session-service.test.ts:30–34`、`session-service-worktree.test.ts:17–21`、`http/serve.test.ts:92,117`、所有 `rpc-*.test.ts`；`worktree-service.test.ts:16` 用模块级 `mkdtempSync` 共享 `$PIE_HOME`。

**方案**：`fs.makeTempDirectoryScoped()`，由 `it.effect` 的 Scope 自动清理（`fs`、`git`、`daemon/*`、`effect-json-store` 的测试已经是这样）。

## Planned Stacked Sequence

按仓库"小切片、一 PR 一事"的规则，用 `gh stack` 串起来：

1. 第 4、5、15 条：`forkDetach` → `forkIn`/`FiberMap`；`daemon.ts` 改 `catchCause` + 结构化 error 日志；`inFlight` 改 `Ref`。这是唯一一批有运行时风险的修复。配套第 26 条把 `session-service` 测试迁到 `@effect/vitest` + `TestClock` 做验证。
2. 第 1 条：`Effect.fn` 替换 `=> Effect.gen`，按 package 拆，纯机械。
3. 第 3 条：`Config` 接管 `serve.ts` / `logging.ts` / `resolve-executable.ts`；`Context.Reference` 承载有默认值的开关。
4. 第 2、13 条：错误统一到 `Schema.TaggedError` + `Schema.Defect()`，同时清理 `mapError` 丢 cause 的点。顺序：`packages/server/src/errors.ts` → 各子域 → `packages/contract` 复用。
5. 第 6、7、10 条：service id 加 `pie/` 前缀、`static layer`、`ScheduleService` 去掉 `provide` 强转。
6. 第 8 条：`rpc/runtime.ts` 组合根用 `provideMerge` 重排。
7. 第 9、11、12、14、18–25 条：逐文件小 PR。
8. 第 27、28 条：测试整理。
9. 第 16、17 条：`EventBus` → `PubSub`、`createServer` → `Layer`，单独开设计讨论。

## Acceptance Criteria

- 第 1–5 条（高优先级）全部关闭：`Effect.fn` 覆盖服务 shape 方法；`Data.TaggedError` 归零；`process.env` 只剩 Electron Main 豁免点；`forkDetach` 归零；`schedule/daemon.ts` 用 `catchCause` 兜底且日志携带 Cause。
- 第 6–17 条（中优先级）每条有独立 PR 或在本文件 Work Log 中记录 wontfix 理由。
- 第 26 条：`session-service` 测试套件在 `@effect/vitest` 下运行，无真实 `Effect.sleep`。
- `pnpm check` 与 `pnpm test` 通过；`.agents/rules/stack.md` 若因本次调整需要补充规则（`Effect.fn`、`Config`、service id 前缀），在同一 stack 内更新。

## Work Log

- 2026-09-03: 审计完成，建立本 ticket。仓库 Issues 功能关闭，故落在 `todos/`。
- 2026-09-03: Stack landed against `main` (not piled on merged PR 160):
  - 1: `Effect.fn` on server service-shape methods (Project, Git, Worktree, FS, Schedule, EventBus, Session*, PullRequest, PiAgentService).
  - 2+13: `Data.TaggedError` → `Schema.TaggedError` + `Schema.Defect` causes; CronError / InvalidPullRequestJsonError tagged; GitHub CLI IO keeps `cause`. Anonymous `Effect.catch(() => Effect.void / succeed(x))` leftovers are `Effect.ignore` / `Effect.orElseSucceed`. `rpc/fs.ts` `READ_FAILED` mapError still drops platform cause — the contract error data has no `cause` field.
  - 3: `PIE_*` via Effect `Config` / `pie/PrintLogs` Reference; tests inject `ConfigProvider.fromUnknown`.
  - 4+5+15+26: `forkDetach` → `forkIn(ownerScope)`; in-flight ids are `Ref<HashSet>`; schedule loop `catchCause` logs Cause; session-service tests are `@effect/vitest` + `TestClock`.
  - 6: Context service ids `pie/…`.
  - 8: `AgentRuntimeLayer` `provideMerge` Infra; Pi executable resolved in `Layer.effect`.
  - 10: `ScheduleService` `provide` constrained to `ScheduleServiceEnv` (no `as`).
  - 11: Effect 4 has `Stream.unwrap` (not `unwrapScoped`). The subscribe RPC returns an AsyncGenerator that outlives the opening Effect, so the explicit `Scope.make` + `Stream.ensuring` stays. `http/server.ts` `Scope.makeUnsafe` kept with a comment (request fibers outlive the creating fiber).
  - 20: `drainQueue` uses `Queue.clear` (non-blocking; `Queue.takeAll` waits for ≥1 message).
  - 21: `rpc/stream.ts` stays as the oRPC AsyncGenerator seam over `Stream.toAsyncIterable` (oRPC validates `AsyncIteratorObject`).
  - 24: pie CLI user output uses Effect `Console.log`.
  - 28 (session-service): scoped temp dirs via `makeTempDirectoryScoped`.
- 2026-09-03: Finding 7 wontfix: `XxxLayer` already exports tag+implementation as two symbols; moving 23 services to `static readonly layer` is a no-runtime rename that would churn every `Layer.provide` site. New services should keep the same two-symbol export, not `static layer`.
- 2026-09-03: Finding 9 wontfix: `cachePiAgentAvailability` still writes the cached check onto the PiAgent object. Production constructs one PiAgent per server lifetime (`PiProcessLayer`); test fakes use `Layer.succeed(PiAgent, makePiAgent(...))`, so `Effect.cached` at `Layer.effect` would not run for them. Closing shape `R` (FileSystem) needs that same fake rewrite. Not a leftover on this ticket.
- 2026-09-03: Finding 12 wontfix: the `_tag` guards sit next to Pi stdout JSON decoding (`unknown` → protocol union). `Predicate.hasProperty` still needs a second narrowing; swapping helpers does not change skip/fail behavior.
- 2026-09-03: Finding 14 wontfix except schedule runtime (already `Semaphore.make`). Remaining `makeUnsafe` in `session.ts` / `session-manager.ts` / `effect-json-store` collection locks is taken inside `Ref.modify` / `SynchronizedRef` callbacks that cannot `yield*`. That is what `makeUnsafe` is for. `PartitionedSemaphore` would replace the lock table, not this stack.
- 2026-09-03: Finding 18 wontfix: `createdAt: new Date().toISOString()` is persistable metadata, not a `TestClock`-driven schedule (those already use `Clock`). `cron.ts` is timezone calendar math `DateTime.startOf` does not replace without a behavior rewrite. `daemon/lock.ts` polling is in an exempt process-lock file. `desktop-runtime-glue.ts` `setTimeout(0)+app.quit` is Electron Main (`stack.md` exemption).
- 2026-09-03: Finding 19 wontfix: Pi turn ids are time-ordered uuid v7 so they sort in transcripts; Effect `Crypto.randomUUID` is v4. A `pie/IdGenerator` tag for two call sites is a new composition-root service. `effect-json-store` `atomic.ts` uses `node:crypto.randomUUID` at a sync tmp-name seam.
- 2026-09-03: Finding 22 wontfix: the ticket already says `Effect.cached` would cache open failures, and lazy-open is the documented retry-on-failure design. Merging `Ref`+`Semaphore` into `SynchronizedRef.modifyEffect` is a gate rewrite with no user-visible bug.
- 2026-09-03: Finding 23 wontfix: non-JSON Pi stdout lines are intentional protocol noise (comment on the try/catch). `Schema.decodeUnknownOption` would still skip them; tagging each as `PiProtocolNoise` would log the noise the skip exists to drop.
- 2026-09-03: Finding 25 wontfix: `renderer-channel.ts` is Electron Main (`stack.md` exemption). `MessageChannelMain` create/close around oRPC stays at that IPC seam; wrapping it in `acquireRelease` does not move it off Promise.
- 2026-09-03: Finding 27 wontfix: desktop `local-server` / RPC tests assert the Promise-shaped `createServer` seam (finding 17). Daemon liveness uses `process.kill` (exempt). Production-adjacent session-service tests (26) are already `it.effect`.
- 2026-09-03: Finding 28 wontfix outside session-service: `http/serve.test.ts` and `rpc-*.test.ts` wrap Node `http` listen + oRPC client (finding 17 Promise seam). `worktree-service.test.ts` module-level `mkdtempSync` is a shared git-CLI fixture, not an Effect Scope. session-service (+ worktree) already use `makeTempDirectoryScoped`.
- 2026-09-03: Finding 16 design: keep the handwritten EventBus. `PubSub.dropping` does not evict a slow subscriber and emit `closed: slow_consumer` — that notification is part of the wire contract (`SubscribeStreamEvent`). Replacing the subscriber table with PubSub would drop that reason or reimplement eviction outside PubSub, which is the current code. Not worth a behavior-risk rewrite.
- 2026-09-03: Finding 17 design: `createServer` stays Promise-shaped at the Node `http` + `ws` upgrade seam (oRPC owns `upgrade`; Effect `HttpServer.serve` would fight it). Startup failures already map through `ServerStartupError` at `Effect.tryPromise`. A `Layer<Server, ServerStartupError, Scope>` is a follow-up that must keep desktop's Promise call site; do not mix it into this stack.
