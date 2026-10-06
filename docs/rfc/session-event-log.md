# Session 编排：Pie 自有事件日志与命令回执

## 状态与范围

**提议，未决。** 基线为 `main@18ba5813`（Pi `0.99.1`）。本文所列决定确认后，会以新 ADR 取代
[ADR 0002](../adr/0002-session-info-storage-floor-harness-overlay.md) 中“不在 Pie 事件库中复制 Pi transcript”
与 [ADR 0009](../adr/0009-pi-session-runtime-and-recovery.md) 中“不持久化第二份事件日志”的决定，
并同步更新 [host persistence inventory](../host-persistence.md)。

保持不变：

- Pi 仍是唯一 agent，运行时仍是 `pi-coding-agent` 的 `AgentSession` 与其 Extension API，每个 Session
  一个 Pie-owned Bun 子进程。Pi session 文件仍是恢复、fork 的原生引用。
- 一个 `$PIE_HOME` 一个 daemon（[ADR 0004](../adr/0004-daemon-lifecycle-and-compatibility.md)），Environment 路由不变
  （[ADR 0005](../adr/0005-environment-rpc-routing.md)）。CLI、Web、Desktop 仍只通过 `@getpie/client` + contract 访问 daemon。

不采用 `@earendil-works/pi-durable` / `chord`：durable 替换了 coding-agent 运行时与 Extension API，Pie 依赖后者；
二者在 Pi 1.0.2 均标注 experimental（durable 的 API “changes without notice”，chord 的计划文档称 “not a stable
public API contract yet”）。等 Pi 稳定版把 coding-agent 迁到 durable 并保留扩展后再评估。

## 1. 现状问题

以下为 `main` 代码事实，标 _推断_ 的需要在实施前用测试确认。

| #   | 问题                                                                                                                                                                                             | 位置                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| P1  | 命令无幂等。`PromptInput.messageId` 只是客户端去重乐观气泡的回显键，服务端不检查；无 command id、无回执。_推断_：WebSocket link 开启 reconnect，丢失响应的 prompt 可能被重发并在 Pi 中执行两次。 | `harness/session-service.ts:497-521`，`packages/client/src/index.ts`，`apps/app/src/features/chat/runtime/chat.ts` |
| P2  | `seq` 只在内存，daemon 重启或 Session close/archive 后从 0 开始；没有 epoch。_推断_：重连时新 seq 已超过客户端旧 cursor，会静默丢弃旧 cursor 以下的事件。                                        | `harness/session.ts:195-222`，`chat.ts`（`snapshot.cursor < cursor` 才视为重启）                                   |
| P3  | daemon 重启丢失：phase/status、active turn 缓冲、retained prompt、pending agent request、Pi 内的 steer/follow-up 队列、进行中的 turn。没有显式收尾，所有 Session 读成 idle。                     | `contract/src/domain.ts`（queue 注释），`harness/session-manager.ts`                                               |
| P4  | 历史读取与模型读取会拉起 Pi 子进程：`getMessages` 在没有冷读实现时走 `ensureRuntime`；`setModel`/`getModelState` 走 `withLiveRuntime`。这与 #236（释放空闲子进程）直接冲突。                     | `session-service.ts:470-479`、`777-812`，`pi/agent.ts`                                                             |
| P5  | `slow_consumer` 只看服务端 Effect 队列（256），不计已发出但未被客户端消费的数据；`global` 订阅承载所有 Session 的全部 chunk。                                                                    | `events/event-bus.ts`                                                                                              |
| P6  | Collection 事件无 seq、无顺序保证，仅作失效信号；列表另外每 10s 轮询。Schedule 结算每 200ms 轮询 `getStatus`、约 60s 上限，_推断_ 更长的 turn 会被记为未结束。                                   | `use-project-session-rows.ts`，`schedule/settle.ts`                                                                |
| P7  | close/archive/delete 进行中的 turn：drain fiber 先被中断，`turn.ended(canceled)` 不会发布，订阅者只收到 `closed`。                                                                               | `harness/session.ts:284-285`                                                                                       |
| P8  | 契约中 `session.request.rejected`、`stream_replaced`、`server_shutdown`、`internal_error` 已声明但从不发出；daemon 关闭时客户端收不到 `closed`。                                                 | `contract/src/domain.ts`                                                                                           |

与本文架构无关、可以立即单独修的缺陷（见切片 0）：

- `use-session-list-sync.ts` 在 `isAbortError` 时直接 `return`，而 `chat-subscription.ts` 注明断开的 socket
  同样表现为 AbortError —— socket 断开后 Session 列表同步会永久停止，只剩 10s 轮询兜底。
- CLI `waitForSession` 先读快照后订阅，turn 在两者之间结束会等到超时；`awaitTurn` 中对 `session.closed`
  的判断不可达（collection 事件不会进入 session 作用域订阅）。

## 2. 参考设计

[t3code](https://github.com/pingdotgg/t3code)（`cf3e714b0`，orchestration v2）同样以 `pi --mode rpc` 接入 Pi，
不加 `--no-*` 参数、保留用户扩展与 skills，以 Pi session 文件路径作为持久的 `nativeThreadRef`、以
`agent_settled` 作为 turn 终止信号。它在此之上自建：

- **事件日志为唯一事实来源**：SQLite（WAL）中的 events（全局自增 sequence）、projections、
  command receipts、effect outbox，在同一事务提交，提交后才推送。
- **发布顺序**：事务内持有单许可 publish lane 直到推送完成，防止后提交的事件先到达而被客户端
  `seq <= cursor` 丢弃。
- **加入与重连**：无 cursor → 快照 + `snapshotSequence`；带 `afterSequence` → 缺口 ≤128 条且 ≤1 MiB 时从日志重放，
  否则发新快照。更早的历史按 HTTP 分页。
- **慢消费者**：每订阅 1000 条 / 8 MiB 预算，**包含等待客户端 ACK 的批次**；超出则以可恢复错误结束流，
  客户端带 cursor 重新订阅，不阻塞生产者。
- **命令幂等**：客户端生成 `commandId`；按线程加锁，按回执去重，重试返回同一 sequence；重连不自动重放修改。
  服务端生成的命令使用确定性 id。
- **先提交意图，再做副作用**：命令确认表示意图已提交，不表示 provider 已完成；provider 事件由 ingestor
  转成领域事件。
- **重启显式收尾**：未结束的运行标记 `cancelled`，待答请求标记 `not_resumable`，与进程绑定的 outbox 效果丢弃
  不重放；排队消息保留。provider 进程中途退出时本轮失败并提示重试，不自动复活；会话空闲 30 分钟回收，按需重开。
- **自有 transcript**：规范化后的消息存在自己的 SQLite；原生历史只用于 resume / fork。
- 代价：已持久化事件必须一直可解码，一条不兼容事件可能导致整个 environment 启动失败；它从 v1 迁到 v2
  时专门写了导入逻辑并以协议版本硬门禁。

## 3. 提议设计

```text
client ──command(commandId)──▶ RPC ──▶ Orchestrator（per-Session lock）
                                         │ decide
                                         ▼
                    SQLite 事务：events + projections + receipt + outbox
                                         │ commit → publish lane
                       ┌─────────────────┴──────────────────┐
                       ▼                                    ▼
               EventBus → 订阅者                    EffectWorker → PiProcess
                                                            │ Pi 事件
                                                            ▼
                                                  Ingestor → Orchestrator（同一路径落库）
```

- **存储**：`$PIE_HOME/storage/state.sqlite`（WAL），路径由 `config/paths.ts` 派生。现有
  `storage/sessions/**.json` 迁入 projection 表；`projects.json`、`settings.json`、schedule 记录暂不迁移。
- **事件与 projection**：Session 事件与 collection 事件进入同一日志，带全局 sequence。projection 至少包括
  sessions、turns、pending_requests、queue。流式 chunk 不逐条落库：按时间窗合并，turn 结束时写入完整消息；
  进行中的 chunk 仍走内存缓冲，崩溃时最多丢失一个合并窗口。
- **同步协议**：`subscribe({ scope, afterSequence? })`。快照携带 `snapshotSequence` 与 daemon epoch；
  有界缺口从日志重放，超出则发新快照；预算计入未确认数据，溢出发 `closed: slow_consumer` 后由客户端带 cursor 重订阅。
  `global` 订阅只承载 collection 事件与 Session 摘要，不再承载所有 chunk。列表与 Schedule 的轮询改为订阅。
- **命令**：所有修改类 RPC 接受客户端生成的 `commandId`，在 receipts 表去重；Pie 内部发起的命令（Schedule、
  Session Loop 唤醒、重启继续）使用确定性 id。
- **副作用**：对 Pi 的 prompt/steer/follow-up/abort/respond 作为 outbox 条目执行；与进程绑定的条目在进程丢失后作废。
- **重启收尾**：启动时把未终止的 turn 标记为 `interrupted`，pending request 标记为不可恢复并发出
  `session.request.rejected`，Session 状态写为 `stopped`；排队消息是否保留取决于 D3。
- **运行时生命周期**：历史、模型、状态读取全部来自 projection，不再拉起 Pi 子进程；运行时按需启动、空闲回收，
  直接支撑 #236。Session Loop / Schedule 的唤醒作为带回执的命令进入同一路径，支撑 #286。
- **扩展请求**：Pi 的 `extension_ui_request` 进入 pending_requests projection，带 `live` / `not_resumable` 能力标记。
  这为将来重新开放用户扩展（`CONTEXT.md` 现明确禁用自动发现）提供可落地的状态模型，但开放本身不在本 RFC 范围内。

## 4. 需要确认的决定

按 [persistence.md](../../.agents/rules/topics/persistence.md) 的 host-write 门禁，以下须在实施前确认：

- **D1 存储**：位置 `$PIE_HOME/storage/state.sqlite`；目录 `0700`、文件 `0600`；一个 daemon 写入（沿用 ADR 0004 的锁）；
  WAL + `synchronous=NORMAL`；随 `$PIE_HOME` 保留，删除 Session 时删除其事件与 projection；损坏或版本更新的库
  拒绝启动并给出明确错误，不自动删除。
- **D2 transcript 归属**：
  - A（推荐）：Pie 保存规范化后的已完成消息，作为界面与冷读来源；Pi session 文件只用于 resume / fork。
    代价是内容存两份，且需要 Pi 历史导入。
  - B：仍从 Pi 历史读取，日志只存编排事件。代价是 P4 无法解决，#236 仍受阻。
- **D3 队列归属**：steer / follow-up 由 Pie 持久化排队、在 turn 边界投递给 Pi（重启可保留），还是继续交给 Pi
  内存队列（重启丢失，现状）。
- **D4 已有数据**：首次启动把 Session JSON 迁入 SQLite（保留原文件只读作回退）；已有 Pi 历史在首次打开时惰性导入
  （D2=A 时）。
- **D5 兼容与回退**：Web、Desktop、CLI 与 daemon 同版本发布，ADR 0004 的兼容键已要求精确匹配，协议可以硬切换并加
  协议版本号。降级到旧版本时旧 daemon 读不到 SQLite 中的新 Session，是否接受。
- **D6 外部 Pi 共享**：Pie Session 继续写 Pi 的 session 文件、可在 Pi CLI 中继续；Pi CLI 中继续产生的内容不会自动
  出现在 Pie 的 transcript 中，需要在下次打开时从 Pi 历史补齐（D2=A 时）。

## 5. 切片

按顺序以 stack 交付，每片独立可验证：

0. **独立缺陷修复**（不依赖本 RFC）：Session 列表在 socket 断开后恢复重订阅；CLI 先订阅后读快照；close 进行中 turn
   时发布 `turn.ended(canceled)`。
1. SQLite 基础与 Session 记录迁移，行为不变；更新持久化清单。
2. 事件日志、持久 sequence 与 epoch、publish lane；`afterSequence` 协议与有界重放；预算计入未确认数据。
3. `commandId` 与 receipts，三个客户端同步生成 id。
4. outbox 与重启收尾；补齐 `request.rejected`、`server_shutdown`。
5. transcript projection 与冷读（D2=A）；读路径不再拉起 Pi 子进程。
6. collection 事件入日志，移除列表与 Schedule 结算轮询。
7. 新 ADR 取代 ADR 0002 / 0009 的相关部分；删除本 RFC 中已落地的内容。

#236（空闲回收）与 #286（Loop 与 Schedule 统一）在切片 5 之后各自推进。

## 6. 验收

- 重放：同一 `commandId` 重复提交只产生一次 Pi turn，返回相同 sequence。
- 重连：客户端在缺口内重连得到逐条重放，超出时得到快照；daemon 重启后不丢、不重复事件。
- 并发：两个客户端同时 prompt / steer / 回答同一请求，事件顺序与 projection 一致。
- 崩溃：在 turn 中途杀 Pi 子进程与 daemon，重启后 turn 为 `interrupted`、请求不可恢复，界面明确提示。
- 慢客户端：限速客户端触发 `slow_consumer` 后能用 cursor 恢复，生产者与其他客户端不受影响。
- 读路径：打开历史、查看模型、列表展示不启动 Pi 子进程（以进程计数验证）。
- 迁移：用现有 `$PIE_HOME` 副本升级，Session、标题、PR 关联、模型完整保留；损坏库拒绝启动。
- Web、Desktop、CLI 各自按 [acceptance](../../.agents/rules/workflows/acceptance.md) 留存证据；真实模型验证须事先授权。

## 7. 不做

- 不替换 Pi 运行时，不引入 `pi-durable` / `chord`，不自建插件系统。
- 不在本 RFC 中开放用户 Pi 扩展自动发现。
- 不实现 turn 中途从断点自动继续；如需要，参照 t3code 的保守“重启后继续”作为后续提案。
- 不把 projects、settings、schedule 记录迁入 SQLite（可在后续单独评估）。
