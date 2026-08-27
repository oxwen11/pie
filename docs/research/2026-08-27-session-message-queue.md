# Session 消息队列调研

> 对照：Pi 0.84.2 RPC（`@earendil-works/pi-coding-agent`）、Pi TUI *Message Queue*、Cursor 式 follow-up 队列。
> 相关：`docs/adr/0003-pi-history-role-segmentation.md`、`docs/design/pi-history-read-design.md` §6.1、`docs/design/multi-client-sync-improvements.md` P1-1。

---

## 结论

**不要在 pie 里再造一条 prompt 收件箱。** Pi 子进程已经是队列权威：`steer` / `follow_up` 入队，`queue_update` 广播，投递后以普通 `user` entry 落盘。pie 缺的是把这条能力接到 wire 和输入栏。

推荐 v1：

1. 进行中允许继续发送；默认 **follow-up**（当前轮全部结束后才投递），steer 用修饰键。
2. 服务端按 Pi 会话态分流：idle → `prompt`；active → `follow_up` 或 `steer`；失败则等当前流收尾再 `prompt`（现有 steer 回退已经这样做）。
3. 把 Pi 的 `queue_update` 投影成会话事件 + snapshot 字段，UI 画排队条，**不要**把未投递的条目写进 transcript。
4. Stop 与 Send 拆开：streaming 时两者同时可用。
5. 单条撤销 / abort 还原进输入框 **不做**——RPC 没有 `clear_queue`（SDK 有 `clearQueue()`，TUI Escape 走的就是它）。

否决：客户端本地排队等到 `turn.ended` 再发；`SessionRuntime` 内存收件箱（那是给 *没有* 原生队列的 harness 的，见下文 P1-1）。

---

## 1. 要的是什么

产品语义就是 Pi TUI 已经写进 `docs/usage.md` 的 **Message Queue**：agent 还在跑时用户可以继续提交。两条投递通道：

| 通道 | 何时投递 | Pi TUI | 适合 |
| ---- | -------- | ------ | ---- |
| **steer** | 当前 assistant 这一跳的工具跑完、下一次 LLM 调用之前 | Enter（streaming 时） | 「停下，改做这个」 |
| **follow-up** | agent 不再有工具调用、也不再有 steering 时；实现上在 outer loop `continue`、`agent_end` 之前，**同一轮 `runAgent` 延长，不开新 run** | Alt+Enter | 「做完这件事后再做那个」——Cursor 式队列 |

`steeringMode` / `followUpMode` 默认都是 **`one-at-a-time`**：每个边界只吐一条。连发三条，后两条继续排，不会一次灌进去。

Cursor Cloud 的 follow-up 队列更接近 **follow-up**，不是 steer：用户可以在当前 run 还在干活时把下一条问话排进去，agent 做完再吃。pie 要对齐的是这个，而不是把每次回车都打成 steer。

---

## 2. pie 今天实际在做什么

三层对不齐。

### UI：进行中直接拒发

`ChatInputComposer`：`turnInProgress` 时 `onSubmit` 返回 `false`（内容留在编辑器）；提交按钮在 `status === "streaming"` 时变成 Stop，不再是 Send。

```39:42:apps/app/src/features/chat/components/chat-input-composer.tsx
    onSubmit: (text) => {
      // Turn in progress: don't send, don't clear.
      if (turnInProgressRef.current) return false;
      prompt(text);
```

用户没有排队入口。

### 客户端：一律当「已经进 transcript 的 user 泡」

`Chat.prompt()` 乐观插入 user 消息，RPC 一成功就当本轮开始。`session.prompt.submitted` 会再插一次（按 `messageId` 去重）。snapshot 只保留 **最新一条** `activePrompt`——第二条进行中提交会盖掉第一条。

这对 idle 开新轮是对的；对「还在排队、还没投递」是错的。排队条目不属于 transcript，刷新后也不该靠 `activePrompt` 复活成一条气泡。

### 服务端：active 一律 steer，队列事件扔掉

`packages/server/src/harness/pi/process.ts` 的 turn 机：`Idle` → `prompt`；`Active` → `steer`；`Finishing` → 等当前流结束后再递归。steer 命令失败则等 turn 结束再当新 prompt。测试钉死了「第二次 prompt 不 `started`、共用 `turnId`」。

`follow_up` **从未发出**。

`createPiTransform` 把 `queue_update` 列在 skip-list 里（`transform.ts` 的 `satisfies`），不产生任何 UI chunk——这是对的，队列不是 transcript。但 fold / snapshot / 客户端也没有任何队列投影，所以 UI 看不见、中途加入的客户端也看不见。

`getCapabilities` 已经宣称 `supportsSteering: true`。能力位在，产品面没接。

### 和旧设计稿的关系

- **ADR 0003 / history 设计**：steer 和 follow-up 投递后都是普通 `user` entry；live transform 已在 `message_start role=user`（且本 run 已有 assistant 输出）处切段。**投递之后的 transcript 路径已经通了**，缺的是投递之前。
- **`multi-client-sync-improvements.md` P1-1**：给 *不支持* steer 的 harness 做内存收件箱，`turn.ended` 再 promote。Pi 不是这个情况。给 Pi 再做一条 inbox 会和 `queue_update` 双写、时序对不齐（follow-up 在 `agent_end` 前投递，不是 `turn.ended` 后）。P1-1 仍然只适用于将来若接回「硬拒」的 harness。
- **`map.md` out of scope 的 steer 勘误**：代码早已 steer；文档说过，这里不再重议。

---

## 3. Pi 0.84.2 RPC 能力面（已核对类型）

权威：`docs/rpc.md` + `dist/modes/rpc/rpc-types.d.ts`。pie 已经 type-only 依赖这套命令。

### 入队

```json
{"type": "prompt", "message": "...", "streamingBehavior": "steer" | "followUp"}
{"type": "steer", "message": "..."}
{"type": "follow_up", "message": "..."}
```

- streaming 时 `prompt` **必须**带 `streamingBehavior`，否则命令失败。
- idle 时用 `steer` / `follow_up` 会怎样：现有 pie 对 steer 的处理是失败 → 等 → 再 `prompt`。follow-up 应同一套回退，避免「刚好 settle」的竞态把消息丢掉。
- 扩展命令（`/foo`）不能进队列，必须走 `prompt`（即使 streaming 也立即执行）。slash 命令是后话，v1 文本队列可以先不管。
- skill / prompt template 在 Pi 侧展开后再入队。

### 观察

`queue_update`：

```json
{ "type": "queue_update", "steering": ["Focus on error handling"], "followUp": ["After that, summarize"] }
```

整表替换，不是 diff。条目是 **纯字符串**，没有 id。Pi 投递时按 `contentText` 做 `indexOf` 删第一条匹配——重复文本会对错行，这是上游限制，pie 不要发明 id 装成能点对点撤销。

`get_state` 只有 `pendingMessageCount`，没有正文。正文只能来自 `queue_update`（或进程内 SDK 的 `getSteeringMessages()` / `getFollowUpMessages()`，RPC 子进程路径用不上）。

### 模式

`set_steering_mode` / `set_follow_up_mode`：`all` | `one-at-a-time`（默认）。v1 不暴露，跟 Pi 默认走。

### 缺口：RPC 没有清队列

SDK `AgentSession.clearQueue()` 返回 `{ steering, followUp }` 并 `_emitQueueUpdate()`。TUI Escape / Alt+Up 走这条：清队列、拼回编辑器，可选再 abort。

RPC 命令表（0.84.2）**没有** `clear_queue` / `dequeue`。`abort` 只 `session.abort()` → `waitForIdle()`，**不清队列**。因此：

- pie 今天的 `interrupt` = RPC `abort`。若已有 follow-up，abort 之后它们仍可能在 settle 时投递——一旦 UI 开放排队，Stop 会变得很奇怪。
- 没有 RPC 就做不了「Escape 还原到输入框」或「叉掉某一条」。

v1 接受：队列展示 + 投递；不提供撤销。Stop 的语义保持「打断当前 run」，并在文档里写明排队条目可能随后投递。若产品要求 Stop 同时丢掉队列，就要要么等上游加 RPC，要么 pie 自己记一份「已撤销」过滤（Pi 仍会投递，transcript 会冒出来——过滤是撒谎，不推荐）。

---

## 4. 推荐架构

权威在 Pi。pie 做投影、分流、画 UI。

```
composer ──prompt({ delivery })──► session-service
                                      │ idle    → process.prompt
                                      │ active  → follow_up | steer
                                      │ fail    → wait Finishing → prompt
                                      ▼
                               Pi child (队列权威)
                                      │ queue_update
                                      ▼
                               session-fold.pendingQueue
                                      │ session.queue.updated
                                      ▼
                               Chat / 其他客户端画排队条
                                      │
                               message_start role=user（已有 transform 切段）
                                      │
                               queue_update 缩短 → 条目从排队条消失、进 transcript
```

### 4.1 契约

`PromptInput` 增加可选：

```ts
delivery: Schema.optionalKey(Schema.Literals(["steer", "followUp"]))
```

省略 = 今天的行为：idle 开新轮，active 当 steer（兼容现有测试与任何没改的客户端）。新 UI 在 `turnInProgress` 时显式传 `followUp`（默认）或 `steer`。

不要为排队另开 RPC 方法。`session.prompt` 已经是「把 user 输入交给会话」；delivery 只是投递时机。`PromptOutput` 仍是 `{ turnId }`：排队不新开 turn，回当前 `activeTurn.turnId`（没有 active turn 时与今天一样新发一个）。

新增会话事件（加入 `SessionScopedEventTypes`，带 seq）：

```ts
{ type: "session.queue.updated"; steering: string[]; followUp: string[] }
```

snapshot 增加：

```ts
pendingQueue: { steering: string[]; followUp: string[] } | null
```

`null` = 从未见过 `queue_update`（进程刚起来）；空数组 = 明确为空。中途加入的客户端从 snapshot 水合，不靠重放全部 `queue_update`。

`session.prompt.submitted` **不要**用于排队条目。它的语义是「这条已经是 transcript 里的 user 消息」（`activePrompt` 给中途加入者补气泡）。排队条目只活在 `pendingQueue`。投递后由 live chunk / 历史读进入 messages。

### 4.2 服务端

`PiProcess.session.prompt` 的 `TurnDecision` 增加 delivery：

- `Idle` → 现有 `prompt` 命令。若调用方标了 `followUp`/`steer` 也无所谓，idle 就是新轮。
- `Active` + `followUp` → `{ type: "follow_up", message }`；失败则走今天的 Wait 回退。
- `Active` + `steer`（或省略 delivery，保持兼容）→ 现有 `steer`。
- `Finishing` → 仍 Wait，再 suspend。跟在 Pi 自己的队列后面再发，避免和 `queue_update` 打架。

runtime 的事件泵：`queue_update` 不进 UI chunk 流（transform 继续 skip），另外 `emit({ type: "session.queue.updated", steering, followUp })`。fold 写入 `pendingQueue`。turn 结束 **不要**清这个字段——Pi 会在真正变空时再发 `queue_update`。abort / crash 同样等 Pi 的事件；crash 可把 `pendingQueue` 置空，因为子进程没了。

`TurnAlreadyRunning` 对 Pi 路径继续不出现（能力位已是 true）。不要把排队失败映射成 `CONFLICT`，那是「硬拒、用户输入丢了」。

文本：现有 `toPromptText` 足够。file part 仍然 `UNSUPPORTED`。图片：Pi 的 steer/follow_up 支持 `images[]`，pie 的 PromptPart 还没接，v1 不带。

### 4.3 客户端

`Chat.prompt(text, delivery?)`：

- idle：今天的路径（乐观气泡 + submitted）。
- streaming/submitted：不 `pushMessage`，不把 status 卡在 `submitted` 盖住 `streaming`；RPC 带 `delivery`（默认 `followUp`）。以随后的 `session.queue.updated` 为准。乐观可以先把文本插进本地 pending 列表，按正文匹配去重（和 Pi 一样没有 id）。

`ChatInputComposer`：

- 去掉「进行中 return false」。
- **Stop 与 Send 拆开**：有内容就能发；streaming 时另有 Stop。今天把 Submit 变成 Stop，是队列功能的主障碍。
- Enter = follow-up（streaming 时）/ 新轮（idle 时）。Alt+Enter（或工具栏「Steer」）= steer。这是 **有意不抄 Pi TUI**（TUI 是 Enter=steer）：web 用户更熟 Cursor，「回车 = 排到做完之后」。在 PR / UI 文案里写一句，避免从 TUI 过来的人以为 Enter 会改道当前轮。

排队条画在 composer 上方，compound 组件，例如 `ChatQueue`：`Root` + `Item`（只读文本 + 通道标签 Steering / Follow-up）。v1 没有叉按钮。数据从 Chat store 的 `pendingQueue` 来，fold 自事件 + snapshot，不要 `useEffect` 同步。

多客户端：A 排队，B 的订阅会收到 `session.queue.updated`。不要第二条乐观路径。

### 4.4 投递后（已有，勿改切段规则）

live：`message_start role=user` 且本 run 已有 assistant → transform 切段（ADR 0003）。
历史：user entry 开新段。steer 与 follow-up 落盘链相同。
`agent_settled` 仍是 run 收尾（不要改成 `agent_end`）——follow-up 延长的就是同一 run。

---

## 5. UI 要点（v1）

- 排队条是「尚未投递」，不是气泡。投递后条目消失、transcript 出现对应 user 消息，中间不要闪一条乐观气泡再替换。
- 空队列不占位。
- Stop 只 abort 当前 run；文案不要写成「取消全部排队」。
- `one-at-a-time`：排队条可以有多条，agent 一次只吃一条，这是预期。

---

## 6. 否决与不在本期

| 方案 | 为何否决 |
| ---- | -------- |
| Chat 本地队列，`turn.ended` 再 `prompt` | 丢掉 Pi 的投递时机（follow-up 在 `agent_end` 前）；多端不同步；刷新丢失 |
| `SessionRuntime.pendingPrompts` 收件箱（P1-1） | 为无原生队列的 harness 而写；Pi 会双写、跟 `queue_update` 漂移 |
| active 继续只 steer、只把 UI 解开 | 回车变成改道当前轮，不是「消息队列」 |
| wire 上给队列条目造 id / 单条删除 | Pi 只有 `string[]` + `indexOf`；装出来的 id 对不上撤销 |
| v1 做 Escape 还原 | 无 `clear_queue` RPC |
| 改 transform 切段 | 投递路径已对，见 ADR 0003 |
| 为队列引入 SQLite / json-store | 队列跟 Pi 子进程走；进程死了队列本来就该没。和「transcript 地板在 harness」一致 |

后话（有意不做进 v1）：slash 在 streaming 时走 `prompt`；图片入队；暴露 steering/followUp mode；上游补 `clear_queue` 之后的撤销 / abort 还原；P1-1 给别的 harness。

---

## 7. 建议落地顺序

四步，每步可单独合。不要和「多端 inbox」捆在一起。

1. **Pi 分流 + 单测**：`process.ts` 按 delivery 发 `follow_up`/`steer`；假 RPC 钉 `follow_up` 命令；idle 回退仍走 `prompt`。无 UI。
2. **投影**：runtime 转发 `queue_update` → `session.queue.updated`；fold + snapshot `pendingQueue`；transform 继续 skip。契约测试。
3. **Composer**：Send/Stop 拆开；streaming 可发；默认 `followUp`。无排队条也能用（用户只是暂时看不见排了什么）。
4. **排队条**：snapshot + 事件水合；多端可见。

第 3 步没有第 4 步时，用户会感觉「发出去了但气泡没出现」——所以 3 和 4 最好同一 PR，1–2 可以先合。

验收：

- streaming 时发一条 follow-up：排队条出现，当前 assistant 继续，settle 后才出现 user 气泡并开下一段。
- Alt+Enter steer：在下一跳 LLM 前插入，当前工具跑完即切段（已有 transform 测试可扩一条 follow-up 形状）。
- 第二客户端 attach：snapshot 带上未投递队列。
- 刷新：未投递队列随 Pi 进程还在而还在；server 重启（子进程没了）则队列空，这是接受项。
- 现有 idle prompt、interrupt、steer 切段、历史对拍保持绿。

---

## 8. 开放决策（实现前只需拍板这两条）

1. **Streaming 时 Enter 默认 follow-up，还是抄 TUI 默认 steer？** 建议 follow-up（Cursor）。TUI 用户用 Alt+Enter / 按钮 steers。
2. **Stop 是否必须同时丢掉队列？** 建议 v1 否（RPC 做不到诚实的清）。若必须，停在第 1 步之前，先向上游要 `clear_queue`。

---

## 9. 关键代码索引

| 层 | 位置 | 现状 |
| -- | ---- | ---- |
| Pi RPC 命令 | `pi-coding-agent` `rpc-types.d.ts` / `docs/rpc.md` | `steer` / `follow_up` / `queue_update` / 无 `clear_queue` |
| turn 分流 | `packages/server/src/harness/pi/process.ts` | Active → 只 `steer` |
| 事件变换 | `packages/server/src/harness/pi/transform.ts` | `queue_update` skip |
| 投递切段 | 同上 + ADR 0003 | 已处理 `message_start role=user` |
| fold / snapshot | `packages/server/src/harness/session-fold.ts`、`packages/contract/src/domain.ts` | 无队列字段；`activePrompt` 只留最新一条 |
| 能力 | `packages/server/src/harness/pi/runtime.ts` | `supportsSteering: true` |
| composer | `apps/app/src/features/chat/components/chat-input-composer.tsx` | 进行中拒发；Submit=Stop |
| Chat | `apps/app/src/features/chat/runtime/chat.ts` | prompt 总是 `pushMessage` |
