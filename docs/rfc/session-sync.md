# 多客户端 Session 同步

## 状态与范围

**方向已确认，接口细节待定。** 基线为 `main@18ba5813`（Pi `0.99.1`）。CLI、Web、Desktop 都是同一个 daemon
的客户端；本文统一它们消费 Session 的规则，并修正当前同步、恢复与运行时生命周期中的缺陷。

保持不变：

- 存储：Pie 记录继续使用 JSON（`@getpie/effect-json-store`），Pi JSONL 会话文件仍是对话记录的权威来源，
  也是 resume / fork 的原生引用（[ADR 0002](../adr/0002-session-info-storage-floor-harness-overlay.md)）。
- 运行时：Pi `pi-coding-agent` 的 `AgentSession` 与 Extension API，每个 Session 一个 Pie-owned Bun 子进程；
  `PiAgentSessionManager` 仍是唯一运行时所有者（[ADR 0009](../adr/0009-pi-session-runtime-and-recovery.md)）。
- 一个 `$PIE_HOME` 一个 daemon（[ADR 0004](../adr/0004-daemon-lifecycle-and-compatibility.md)），Environment 路由不变
  （[ADR 0005](../adr/0005-environment-rpc-routing.md)）。

落地后修订 ADR 0009（补充 epoch、时间线投影、冷读与收尾规则），不推翻它。

## 1. 现状问题

以下为 `main` 代码事实；标 _推断_ 的须在实施时先用测试复现。

| #   | 问题                                                                                                                                                                                | 位置                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| P1  | 命令无幂等。`PromptInput.messageId` 只是客户端去重乐观气泡的回显键，服务端不检查；无 command id、无回执。_推断_：WebSocket 重连后，丢失响应的 prompt 可能被重发并在 Pi 中执行两次。 | `harness/session-service.ts:497-521`，`packages/client/src/index.ts`       |
| P2  | `seq` 只在内存，daemon 重启或 Session close/archive 后从 0 开始，没有 epoch。_推断_：重连时新 seq 已超过客户端旧 cursor，事件被静默丢弃。                                           | `harness/session.ts:195-222`，`apps/app/src/features/chat/runtime/chat.ts` |
| P3  | daemon 重启丢失 phase、active turn 缓冲、retained prompt、pending agent request 与 Pi 内队列，没有显式收尾，所有 Session 读成 idle。                                                | `harness/session-manager.ts`，`contract/src/domain.ts`                     |
| P4  | 历史读取（`getMessages` 无冷读实现，走 `ensureRuntime`）与 `setModel`/`getModelState`（`withLiveRuntime`）都会拉起 Pi 子进程，阻碍 #236。                                           | `session-service.ts:470-479`、`777-812`，`pi/agent.ts`                     |
| P5  | `slow_consumer` 只看服务端队列（256），不计已发出未消费的数据；`global` 订阅承载所有 Session 的全部 chunk。                                                                         | `events/event-bus.ts`                                                      |
| P6  | Collection 事件无 seq，仅作失效信号，列表另外每 10s 轮询；Schedule 结算每 200ms 轮询状态、约 60s 上限，_推断_ 更长的 turn 被记为未结束。                                            | `features/projects/use-project-session-rows.ts`，`schedule/settle.ts`      |
| P7  | close/archive/delete 进行中的 turn：drain fiber 先被中断，`turn.ended(canceled)` 不发布，订阅者只收到 `closed`。                                                                    | `harness/session.ts:284-285`                                               |
| P8  | `session.request.rejected`、`stream_replaced`、`server_shutdown`、`internal_error` 已声明从不发出；daemon 关闭时客户端收不到 `closed`。                                             | `contract/src/domain.ts`                                                   |

独立缺陷（切片 0，不依赖本文其余设计）：

- `use-session-list-sync.ts` 遇到 `isAbortError` 直接 `return`，而 `chat-subscription.ts` 注明断开的 socket 同样表现为
  AbortError —— socket 断开后 Session 列表同步永久停止，只剩轮询兜底。
- CLI `waitForSession` 先读快照后订阅，turn 在两者之间结束会等到超时；`awaitTurn` 对 `session.closed` 的判断不可达。
- 见 P7。

## 2. 参考

- **[Paseo](https://github.com/getpaseo/paseo)**（`f5c55dfc`，本方案主要参照）：daemon 只用 JSON 文件持久化，
  “Paseo uses file-based JSON persistence instead of a traditional database”；store 方法要求
  “maps cleanly to one SQL statement or one SQL transaction, even when the current implementation is JSON files”。
  时间线投影保存在内存，provider 历史是对话记录权威，恢复时由它重建；事件带 `epoch` 与 seq，缺口按页补齐至
  `hasNewer: false`；工具输出进入时间线前截断到 64 KiB；“连接正常”与“消息最新”分开呈现；持久缓存放在客户端。
  见 `docs/data-model.md`、`docs/timeline-sync.md`。
- **[t3code](https://github.com/pingdotgg/t3code)**（`cf3e714b0`，作为上限参照）：同样以 `pi --mode rpc` 接入 Pi 并保留用户扩展，
  但自建 SQLite 事件日志、command receipts 与 effect outbox，重启后可逐条重放事件、跨重启去重。代价是事件格式
  必须永久可解码、需要迁移机制。本方案暂不走到这一步，触发条件见第 6 节。
- **Pi 实验性 client/server**（`earendil-works/pi@76f6c06d`，`pi-server` / `pi-client` / `pi-protocol` / `chord` /
  `pi-durable`）：coordinator 持有稳定 socket 并把连接转给可替换的 server 进程，每个 Session 一个 worker 进程运行
  durable Harness。要点：
  - 每个连接一个服务端生成的 `attachmentId`，请求携带 `{serverId, sessionId, attachmentId}`，过期路由以
    `session_not_attached` 拒绝；断开时等已受理的操作结束再释放。
  - 状态以 chord replicated state 同步：**每次（重新）订阅都发完整快照**，之后按每订阅递增的 seq 发增量，
    出现缺口即清空并报错；待推送超过 100 条时把积压替换为一份完整快照（reset）。不做日志补发，历史分页仍是 TODO。
  - 传输层按未写出的字节（`maxPendingBytes`）限制慢客户端，超出即断开。
  - 客户端“never reconnects or replays requests automatically”，重连后只重复已知安全的操作。
  - worker 在有运行中的任务时保持存活，与是否有客户端无关；重启 worker 时 `harness.resume()` 继续中断的工作。
  - durable `submit` 支持持久的 `requestId` 去重，但实验层当前没有使用；扩展提问路由到哪个客户端尚未设计。

  不采用的原因：durable 运行时不支持稳定版 Extension API（扩展改为 durable `Registry` 与 chord facet），MCP、
  codemode、图片、会话树导航、`!` bash、导出、提示词模板均缺失；存储为 SQLite，不兼容 Pi JSONL 会话；
  server/client 不在 npm 包与二进制中发布（需 `PI_EXPERIMENTAL=1` 从源码运行），durable API
  “changes without notice”。本方案借鉴其协议与生命周期规则；等 Pi 稳定版在 durable 上保留扩展能力后再评估迁移。

## 3. 目标架构

```text
 CLI ─┐
 Web ─┼─ @getpie/client · SessionSync（三端共用）
 Desktop┘   订阅 → 尾页快照 → 按 {epoch, seq} 应用增量 → 异常即重订阅 → 新鲜度状态
                      │  oRPC / WebSocket
──────────────────────┼─────────────────────────── daemon（每个 $PIE_HOME 一个）
                      ▼
  命令层：commandId 去重（内存回执，有 TTL）· 每个 Session 串行执行整条命令
                      │
  Session 所有者（PiAgentSessionManager）
   ├─ 时间线投影（内存）：已完成消息 + 当前 turn；工具输出上限 64 KiB
   │     打开时由 daemon 直接解析 Pi JSONL 重建，不拉起子进程
   ├─ 事件标记 {epoch, seq}；推送顺序与提交顺序一致
   ├─ 运行时（Pi 子进程）：按需启动、空闲回收
   └─ 收尾：重启 / 崩溃 / 关闭时，未完成 turn 标记中断，待答请求标记失效，并广播
                      │
  Session 列表流：Session 摘要与增删改事件，带 {epoch, seq}，取代轮询
  后台意图：Schedule / Loop 唤醒等需跨重启送达的动作，写入各自 JSON 记录，确定性 id + 幂等执行
──────────────────────────────────────────────────────────────
 存储：Pie JSON（Session 记录、项目、Schedule；store 接口按数据库语义设计）
       Pi JSONL（对话记录权威，resume / fork）
```

### 3.1 客户端共用 `SessionSync`

`@getpie/client` 提供唯一的 Session 同步实现，Web、Desktop、CLI 共用，取代 Web 的 `RecoveringSubscription`、
`use-session-list-sync` 和 CLI 的临时等待逻辑：

- 总是先订阅、再取快照；只应用 `seq > cursor` 的事件。
- epoch 变化、cursor 回退或缺口无法补齐时，整段替换为服务端最新状态，不保留两段不连续的历史。
- 除用户主动停止外，任何流错误（包括 socket 断开导致的 AbortError）都退避重连。
- 对外暴露两个独立状态：连接健康度、数据新鲜度（正在补齐 / 已最新）。
- CLI 的“等待 turn 结束”按 `turnId` 过滤，并在重连后继续等待。

### 3.2 epoch 与 seq

- daemon 每次启动生成 daemon epoch；Session 每次被打开生成 session epoch。事件、快照、分页结果都携带二者。
- seq 在一个 epoch 内单调递增。现有 `applyLock` 已保证推送顺序与 seq 顺序一致，扩展到所有发布路径（含 Pie 自身
  发出的 `prompt.submitted` 与 collection 事件）。
- 修正自身 prompt 的顺序反转：`prompt.submitted` 必须先于同一 turn 的 `turn.started` 与 chunk。

### 3.3 时间线投影与分页补齐

- daemon 为打开的 Session 在内存维护投影：已完成的消息（与现有 `PiUIMessage` 形状一致）加当前 turn。
  每个投影项记录覆盖的 `seqStart`/`seqEnd`。
- 流式中间态不进入投影；当前 turn 以合并后的完整消息形式更新。工具输出进入投影与实时流前统一截断到 64 KiB，
  完整内容仍在 Pi JSONL 中。
- 默认采用 Pi 的做法：**每次（重新）订阅都返回投影尾页快照**（携带 `{epoch, seq}` 与 `hasOlder`），之后按 seq
  推送增量；同一订阅内出现缺口即视为错误并重新订阅。更早的历史向前分页。
- 携带 `{ epoch, afterSeq }` 从投影按页补齐（Paseo 的做法，带 `hasNewer`）只作为可选优化：仅当尾页快照的体积
  实测成为重连瓶颈时引入，不作为正确性依赖。
- 取代快照中保留整轮 chunk 的 `ActiveTurnSnapshot.truncated` 恢复方式。

### 3.4 冷读与运行时生命周期

- daemon 直接解析 Pi JSONL 会话文件构建历史与投影（复用 `pi/history.ts` 的折叠规则），不经过子进程。
- 模型、状态、列表读取来自 Pie 记录与投影；只有 prompt、steer、follow-up、compact、回答请求等需要 agent
  的操作才启动运行时。
- 运行时空闲回收的策略（超时、扩展持有的后台工作）由 #236 决定；本文只保证读路径不再阻碍回收。
- Pi CLI 在同一会话文件上继续产生的内容，在下次打开或冷读时从 JSONL 补齐。

### 3.5 命令去重

- 所有修改类 RPC 接受客户端生成的 `commandId`（prompt 可沿用 `messageId`）。服务端在内存按 Session 记录回执
  （结果与对应 seq），保留一段时间后清除；重复的 `commandId` 返回首次结果，不再次执行。
- Pie 内部发起的命令（Schedule、Loop 唤醒）使用确定性 id。
- 回执不跨 daemon 重启：重启时进行中的 turn 已被收尾为中断，客户端看到 epoch 变化后重新对齐。
- 与 Pi client 相同，`SessionSync` 重连后**不自动重放修改类命令**；只有调用方明确发起的重试才复用原 `commandId`。
  因此内存回执只需覆盖同一 daemon 生命周期内的重试。
- 整条命令（标题、元数据、交付给 Pi）在同一 Session 内串行，不再拆成独立临界区。

### 3.6 收尾与失败语义

- **daemon 启动**：所有 Session 读作 `stopped`；若记录显示上次有未结束的 turn，向下一位订阅者呈现“上次运行被中断”。
- **Pi 子进程崩溃**：发出 `turn.ended(failed)` 与 `session.crashed`（现状保留），并对每个待答请求发出
  `session.request.rejected`；恢复时的 `clearCrash` 发出状态事件，不再静默。
- **close / archive / delete**：先发布 `turn.ended(canceled)` 与请求失效，再关闭订阅。
- **daemon 关闭**：向订阅者发出 `closed: server_shutdown`。
- `stream_replaced`、`internal_error` 要么接入实际路径，要么从契约删除。

### 3.7 慢客户端

- 预算按订阅计算，计入已交给传输层但客户端尚未消费的数据（WebSocket `bufferedAmount` 或 oRPC 流的确认）。
- 待推送积压超过阈值时，与 chord 相同，把积压替换为一份当前完整快照（reset）继续推送；超出传输层字节上限时以
  `closed: slow_consumer` 结束该订阅，客户端重新订阅取快照。不阻塞生产者与其他订阅者。
- `global` 订阅只承载 collection 事件与 Session 摘要，不再承载所有 Session 的 chunk；daemon 内部订阅者
  （如 `PullRequestCoordinator`）被关闭时自动重订阅。

### 3.8 Session 列表流

- Session 增删改、标题、状态摘要（idle / running / requires_action / stopped）作为 collection 事件，带 `{epoch, seq}`，
  订阅时先给列表快照。
- 列表与 Schedule 结算改为订阅驱动，移除固定间隔轮询；Schedule 等待 `turn.ended` 而非轮询状态。

### 3.9 需跨重启送达的意图

- 与 Pi 进程无关、必须在 daemon 重启后仍被执行的动作（首个场景：Schedule / Session Loop 唤醒，#286），在各自
  JSON 记录中持久化待执行意图，带确定性 id。执行前检查是否已完成，完成后标记，保证重复执行只生效一次。
- 发给 Pi 的 prompt、steer、abort、回答请求与具体进程绑定，不做持久化重放；进程丢失后作废并明确提示用户重试。
- 不建通用 outbox。

## 4. 待确认的接口细节

实施切片 2 前须在本文补充并经 Developer 确认：

1. 订阅输入与快照、reset、历史分页结果的契约形状（`epoch`、`seq`、`seqStart/seqEnd`、`hasOlder`）。
2. 投影页大小与内存上限、空闲 Session 投影的释放时机。
3. `commandId` 回执保留时长与上限。
4. 慢客户端预算数值及“未消费数据”的取得方式（oRPC 是否提供流确认）。
5. “上次运行被中断”是否需要写入 Session JSON 记录（属于 host write，按
   [persistence.md](../../.agents/rules/topics/persistence.md) 确认并更新 [持久化清单](../host-persistence.md)）。
6. Schedule 唤醒意图的记录格式与迁移（同上，属于 host write）。

三端与 daemon 同版本发布，ADR 0004 的兼容键要求精确匹配，契约可以直接切换，不保留旧协议。

## 5. 切片

按顺序以 stack 交付，每片独立可验证：

0. **独立缺陷**：Session 列表断线后重订阅；CLI 先订阅后读快照；close 进行中 turn 时先发布结束事件。
1. **`SessionSync` + epoch + 收尾**：三端改用共用同步模块；事件与快照带 epoch；补齐 P7、P8 的事件；修正
   `prompt.submitted` 顺序。
2. **时间线投影 + 尾页快照 + 历史分页 + 冷读**：读路径不再拉起 Pi 子进程（解锁 #236）。
3. **命令去重 + Session 列表流 + 慢客户端预算**：移除列表与 Schedule 结算轮询。
4. **跨重启意图**：与 #286 一起交付。
5. **修订 ADR 0009**，更新持久化清单与 `CONTEXT.md`，删除本文已落地的内容。

## 6. 何时改用持久事件日志

出现以下任一需求时，按 t3code 的方式评估 SQLite 事件日志、持久回执与 outbox：

- daemon 重启后必须向客户端逐条重放事件，而不是整段重新对齐；
- 需要跨重启的命令去重或审计；
- 需要原子提交“事件 + 状态 + 待执行动作”的场景增多，JSON 记录内的意图已难以管理；
- Pie 迁移到 Pi durable 运行时（届时随其存储一并设计）。

## 7. 验收

- 重复提交：同一 `commandId` 重试只产生一次 Pi turn，返回相同结果。
- 重连：重新订阅得到当前尾页快照，此后增量不重复、不遗漏；epoch 变化时整段对齐；积压时收到 reset 而非断开；
  Session 列表在 socket 断开后恢复；重连不会自动重放修改类命令。
- 并发：两个客户端同时 prompt、steer、回答同一请求，三端看到的事件顺序与最终状态一致。
- 崩溃与关闭：杀 Pi 子进程、重启 daemon、在 turn 中关闭 Session，客户端都收到明确的中断与请求失效。
- 慢客户端：限速客户端被断开后能凭游标恢复，其他客户端不受影响。
- 读路径：打开历史、查看模型、展示列表不启动 Pi 子进程（以进程计数验证）。
- CLI：`waitForSession` / prompt 等待在 turn 于订阅前结束、以及断线重连时都能正确返回。
- 各端按 [acceptance](../../.agents/rules/workflows/acceptance.md) 留存证据；真实模型验证须事先授权。

## 8. 不做

- 不引入 SQLite、通用 outbox、`pi-durable` 或 `chord`，不替换 Pi 运行时。
- 不实现 turn 中途从断点继续；进程丢失即中断并提示重试。
- 不在本文开放用户 Pi 扩展自动发现（`CONTEXT.md` 现明确禁用）。
- 不引入 Pi 式的 coordinator（稳定 socket + 可替换 server 进程、worker 跨 daemon 替换存活）与 per-connection
  `attachmentId`；扩展提问继续广播给所有客户端、先回答者生效。二者留待有具体需求时评估。
- 不改变 Pi JSONL 作为对话记录权威的地位，不在 Pie 中复制完整 transcript。
