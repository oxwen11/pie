# t3code：一个 Thread 关联多个 PR 与 Stack 支持

## 调研范围与版本

核对版本：[`01e05c15268dedb76da95f442fbf5201cd8e7a44`](https://github.com/pingdotgg/t3code/commit/01e05c15268dedb76da95f442fbf5201cd8e7a44)，提交时间 `2026-09-14T07:09:57Z`。本地 checkout 与调研时 GitHub `commits/HEAD` API 返回的 SHA 一致；“最新”仅指本次核对时刻。

源码位于 `/tmp/github.com/pingdotgg/t3code`。本文中的 Thread 是 t3code 的持久会话对象，不将其内部的运行时 session 概念直接等同于 Pie Session。

本文是源码调研，不代表 Pie 已实现这些能力，也不是 GitHub Stack API 可用性的线上验证。上一轮依据的 `57aee3e19f1910f3323f06384bb2a1d02b79e369` 不再是本轮的引用基线。

## 结论

1. **多个关联 PR 与 Stack 是两种关系。** Thread 持有多个稳定 PR 关联；这些 PR 可以属于同一 Stack、多个 Stack，或者彼此无关，甚至来自同一 host 上不同仓库。
2. **关联、分支发现、状态同步分开。** 明确关联使用 `pullRequests[]`；分支检测结果使用 `branchPullRequest`，并不自动等同于持久关联集合。
3. **Stack 不是靠 PR 编号或关联顺序推断。** GitHub 原生 Stack 优先使用 host 返回的层序；没有原生 Stack 的已关联 PR，才按同仓库的 base/head 分支关系推导 chain。
4. **不只保存身份。** 每条关联保存来源、时间、可空状态快照和可空原生 Stack 快照；底层是 SQLite 关联表，不是只有一个 current PR 字段。
5. **Agent 显式登记很重要。** 内置工具要求 Agent 登记它实际创建或处理的每一条 PR；Stack 每层都登记，不只登记顶层。
6. **t3code 的后台同步不依赖 UI demand。** 这是 Pie 明确不照搬的部分：Pie 仍采用 Renderer 声明需求、Server 统一调度、无需求不周期查询 GitHub。

用户文档也明确描述了多关联、取消关联、Stack 展示与远端操作：[source-control.md][user-docs]。

## 1. 数据模型：关联集合、状态、拓扑各有位置

核心类型在 [orchestration.ts][contracts]：

```text
Thread
├─ branch / worktreePath          工作上下文
├─ branchPullRequest              当前记录分支检测出的候选 PR
├─ pullRequests[]                 多个持久关联
│  ├─ host / repository / number  跨 Project 比较的 PR 身份
│  ├─ url
│  ├─ source / linkedAt
│  ├─ snapshot | null             最近同步的 host 状态
│  └─ stack | null                最近同步的原生 Stack 拓扑
└─ linkedPullRequest              兼容旧客户端的单 PR 投影
```

PR 身份不使用 `projectId`：规范化 host、仓库和编号后，同一 PR 被多个 Thread / Project 引用仍是同一对象。Project 仍用于选择可执行查询的环境和仓库上下文；不是说远端查询不再需要上下文。[身份比较与旧投影][shared]

`source` 包含：

- `manual`：用户关联。
- `created`：应用 Git action 创建或打开已有 PR 后登记。
- `agent`：Agent 通过工具登记。
- `stack`：同步器发现的原生 Stack 成员。
- `stack-dismissed`：用户取消关联的已知原生 Stack 成员，作为防止自动加回的记录。

`snapshot` 保存 state、title、headBranch、baseBranch、isDraft、updatedAt、syncedAt，并可包含关闭 / 合并时间、作者、diff 数量、review、checks、mergeability。可选字段兼容旧快照和不同 host 的便宜摘要读取。

`stack` 保存 `kind: native`、id、number、url、base 和由底到顶的 layers；持久层序中的每层包含 PR 编号、head 分支、状态。写操作需要的 head SHA 不靠这个展示快照授权，而是另外实时读取。

SQLite 表 `projection_thread_pull_requests` 的主键为 `(thread_id, host, repository, number)`，另有跨 Thread 查询同一 PR 的索引。`snapshot_json` 和 `stack_json` 分开保存。迁移将旧单 PR 关联转入新表，来源为 manual，两个快照初始为空。[migration 050][migration]

关联 / 取消 / 同步通过 domain command 和 event 更新投影；同步结果不会重新插入已经移除的关联。[decider][decider]、[持久投影][projection]

## 2. 多条 PR 从哪里进入一个 Thread

### 用户与应用操作

支持命令面板、Linked pull requests 面板、对话 PR 链接菜单以及 review 页面关联到 Thread。跨仓库并非任意环境通用：UI 根据所在环境能力和同 host 的 Project 判断是否可路由。[用户文档][user-docs]、[usePullRequestLinking][linking]

应用 Git action 产生 `created` 或 `opened_existing` PR 后，`linkCreatedPullRequest` 从返回 URL 提取身份并写入 `source: created`。关联失败不会把已经成功的 Git action 改成失败，但会记录警告。[创建后登记][created]

### Agent 显式登记

工具包括 `link_pull_request`、`unlink_pull_request`、`list_thread_pull_requests`。调用由 MCP capability context 约束到当前 Thread，不让模型通过工具参数随意指定另一个 Thread。[工具处理][agent-tools]

注入的运行说明要求：

- 创建 PR 或开始处理已有 PR 后立即登记完整 URL。
- Stack 的每一层都登记，而不只登记当前分支或顶层。
- `gh`、`gh stack`、其他 CLI 或 host API 的成功操作不会自动完成 Thread 关联。
- 完成 PR 工作前列出关联，补齐遗漏；不登记仅作背景提及的无关 PR。
- 登记失败要报告，不声称已经关联。

这是上游产品给其 Agent 的运行约定，不是本次调研要执行的工具指令。[RuntimeInstructions][instructions]

Agent 工具把重复关联作为 `alreadyLinked` 返回；底层 decider 对普通重复命令会拒绝，工具层将其转成幂等结果。显式关联一个已 dismissed 的成员则恢复其可见性。

### 分支发现是另一条路径

`ThreadPullRequestReactor` 按保存的 branch / worktree 查询，验证 PR 对应的仓库，再更新 `branchPullRequest`。它没有把每次分支检测结果追加为现代 `pullRequests[]`；源码中另有旧单 PR 的兼容替换逻辑。[发现器][discovery]

因此“分支发现能显示 PR”和“这条 PR 已明确属于 Thread 的多关联集合”不是同一件事。UI 提供 **Link this PR** 将分支候选固定为关联。不能把 t3code 简化成“扫描当前 checkout，把看到的全部自动 append”。

## 3. Stack：原生事实优先，分支链只是后备推导

### 3.1 GitHub 原生 Stack

CLI adapter 经 `gh api` 查询：

```text
GET repos/{owner}/{repo}/stacks?pull_request={number}
GET repos/{owner}/{repo}/stacks/{stackNumber}   需要详情时
```

解码器将 GitHub 的 `pull_requests` 顺序保留为 bottom-to-top，兼容其源码注释中所称 preview API 的几种字段形状。此处描述的是 t3code 的适配实现，不保证所有 GitHub / Enterprise host 均支持该接口。[CLI adapter][cli]、[Stack 解码][stack-json]

404 被适配为“没有可用 Stack”；其他查询错误必须保留上次 Stack 并重试，不得把网络故障解释为 Stack 消失。

`PullRequestSyncReactor` 查询某个已关联 PR 的 Stack 后，将未关联的其他层逐条登记为 `source: stack`。它按 Thread + PR 去重，避免同一个 sweep 内多个成员重复登记兄弟层。新关联的状态初始为空，后续 sweep 再补齐。[同步器][sync]

**自动补齐依赖已关联 PR。** 只有一个 branch-detected badge、不存在正式关联时，不应声称整个 Stack 已进入关联集合。Agent 每层显式登记还可覆盖非原生 chain，以及 host Stack 查询不可用的情况。

### 3.2 推导 chain

纯函数 `resolveThreadPullRequestChains` 的顺序是：[shared/threadPullRequests.ts][shared]

1. 按规范化 host / repository / native stack id 分组，采用原生层序。
2. 对尚未归组的已关联 PR，寻找 `child.baseBranch === parent.headBranch` 的关系。
3. 比较限定在同一 host / repository；分支名区分大小写。
4. head 名称重复时不猜父 PR；环没有可信顶层，保留为独立项。
5. 结果标记为 native 或 derived，未连上的 PR 是单层 chain。

例如：

```text
#120  head: feature/base   base: main
#101  head: feature/ui     base: feature/base
#115  head: feature/test   base: feature/ui

得到 #120 → #101 → #115，而不是按 PR 编号或 linkedAt 排序。
```

这个推导仅处理已经关联的 PR，不递归扫描 GitHub 找所有 base/head 邻居，也不将派生关系写成 host 原生 Stack。分支被重定向后，derived chain 可能变化，不能将其当永久拓扑或批量写操作依据。

### 3.3 取消关联必须防止自动加回

取消一个已知原生 Stack 成员时，decider 将其来源改为 `stack-dismissed`，而非直接删除；前端过滤隐藏，同步器将其视为已经存在，不再加回。[decider][decider]

判断不限于 `source: stack`：手动 / Agent 登记的成员，只要自身已有 Stack 信息，或兄弟 PR 的 Stack 快照列出它，也需要留下此记录。用户显式重关联才恢复。

普通非 Stack 关联则删除。同步器负责补充缺少的成员，源码没有“某 PR 已离开远端 Stack，就自动删除 Thread 关联”的对称清理；关联历史与当前拓扑是独立事实。

## 4. UI 如何表达多个 PR

现代关联的侧栏状态直接取持久快照；只有 branch / legacy fallback 还租用 summary 查询，不应说 t3code 的所有 PR UI 都完全不读远端。[ThreadStatusIndicators][indicators]

- 多条可见 PR 恰好形成一条 chain：Stack 图标与层数。
- 多条无关 PR / 多条 chain：普通 PR 图标与数量，不宣称它们是一个 Stack。
- 当前实现 `ThreadPullRequestBadgeControl` 的多关联文字实际为 `+总数`，tooltip 再说明代表 PR 和额外数量；不要仅根据用户文档概括成始终显示 `#号 +N`。
- 面板列出全部关联，按 chain 层次缩进，区分 native stack 与 derived chain，提供打开与取消关联。[ThreadPullRequestsPanel][panel]

选择一个用于导航 / 单槽展示的 PR 时，优先未完成的工作，链中优先最高未完成层；多个无关链按最近关联的工作选择。全部终态而只有一条链时仍指向顶层；多条无关终态关联则选最近更新者。[shared][shared]

注意实现命名陷阱：`resolveThreadCurrentPullRequest` 的 `kind: stack` 也用于多个互不相关 open PR 的“当前集合”。**是否画 Stack badge 要看 `resolveThreadPullRequestBadge` 的 chain 判断，不能只看前者的 discriminant。**

未知 snapshot 保留关联。聚合选择 / badge 状态将其保守地当成 open，具体未同步行仍显示中性“等待 host 状态”，不是已经核验为 open。任意 open / 未同步关联也会阻止自动 settlement。[共享规则][shared]、[settlement policy][settlement]

## 5. 同步与持久化：值得借鉴的边界

`PullRequestSyncReactor` 启动后 sweep，此后每分钟运行；读取非归档 Thread 的可见关联，按 host / repository / PR number 合并，**并发上限 8**。[同步器][sync]

- 未同步关联：到期。
- 未 settled Thread 上的 open PR：每分钟 sweep 可读。
- closed PR、仅在 settled Thread 上的 open PR：15 分钟节奏，覆盖 reopen。
- 全部关联快照均为 merged 的 PR：不常规刷新。
- 显式 refresh、失败待重试的 Stack：可打破上述终态跳过。
- 同一 PR 被多个 Thread 关联：一次 host 读取，分别写回各 Thread。
- 单项失败：保留旧快照并继续其他 PR，不使整批消失。

**并非每分钟都查完整 Stack。** 只有首次 snapshot、摘要字段变化、显式刷新或先前 Stack 查询失败时才读取 Stack。Stack 查询失败会保留旧值并记重试；仅远端拓扑变化且摘要完全没变时，不能由此承诺一分钟内自动发现。显式刷新覆盖此路径。

**也不是每次成功读取都写盘。** 比较时排除 `syncedAt`，仅摘要内容或 Stack 变化才 dispatch；无变化时只更新内存 cadence。因而持久 `syncedAt` 不能在未修订语义的情况下照搬成 Pie 的“最近一次成功核验时间”。

显式 PR action 成功或指定 PR 的 invalidate 会请求同步；读期间新来的刷新请求有 generation 保留，不被旧读取吞掉。[ws 路由][ws]

分支发现器另有创建、元数据、turn-diff、恢复活跃等事件触发，并有每分钟发现兜底；源码明确注释 **Run without client demand**。`forkParked` 是 Server 启动激活门，不是 UI 订阅计数器。[发现器][discovery]、[serverActivation][activation]

## 6. Stack 支持不止显示，但写操作是独立能力

t3code 已有 Merge stack 和 Rebase stack：[gitHubStackActions.ts][actions]

- Merge：重新读取 Stack，验证目标成员、每个受影响未合并层的 expected head，提交所选层及下方未合并层的 GitHub `merge-async` 操作，再轮询结果；不是本地循环盲目 `gh pr merge`。
- Rebase：要求目标是最高层，预检各层分支权限，按底到顶调用远端 `updatePullRequestBranch`，携带 expected head，并复查已处理层是否又被修改。不切换或重写本地 checkout。
- 失败可能留下前面已经完成的远端更新，不伪装成原子操作，也不自动回滚重写。
- Service 再检查 host 能力、用户权限和合法 action / method。[PullRequestService][service]

这说明“识别 / 展示 Stack”和“安全操作 Stack”必须分阶段。不能给 derived chain 画完图标，就将其自动接到批量 merge / rebase。

## 7. 对 Pie 初版草案的修正建议

以下保留调研时的 **Pie 建议**，不是上游行为，也未修改产品代码。后续讨论已统一为[尽早关联、按需更新方案][pie-design]；实施范围和触发规则以该设计为准。

### 可以直接借鉴

1. 保留 `SessionRef { projectId, sessionId }` 作为关联所有者，另以完整 PR 身份去重；不要用“当前分支当前 PR”覆盖整个历史集合。
2. 提供明确的关联 / 取消 / 列出入口，并给 Agent 一个受当前 Session 约束的登记入口。创建、切分支、修改多仓库 PR 时，显式身份比 checkout 猜测可靠。
3. 将“关联集合”“状态快照”“Stack 拓扑”分开。初版草案的 lifecycle-only snapshot 足以修复侧栏稳定性，**不足以实现 derived chain**；要支持它，至少还需可信 head/base。原生 Stack 也需保存 host 返回的层序；更新后的设计已纳入这些字段。
4. 原生成员自动展开时保留取消关联记录。否则下一轮同步会把用户刚移除的层加回。
5. Sidebar 统一读关联快照；多关联数量和 Stack 层数是不同展示语义。未知 / 查询失败不删除已知身份。

### 不照搬

- 不引入 t3code 的 SQLite 投影系统或多个 reactor。Pie 可继续用现有 Session 元数据、Session service 和一个 PR 协调器。
- 不顺手引入多 provider 和所有详情字段。Stack 写操作需要独立的权限、确认和并发保护；后续设计已将其纳入范围，但仍与关联和读取分开实施、验收。
- 不把多 PR 等同于 Stack，不把关联顺序当 Stack 顺序，也不把推导 chain 当 host 原生事实。
- 不复制无 UI 需求的持续同步。Pie 的约束仍是 **Renderer 声明侧栏需要哪些 Session → Server 去重和调度 → 无需求不周期执行 `gh`**。返回侧栏时先读快照，再刷新过期 / dirty 数据；无需求时 turn-end 标记 dirty，不直接触发 GitHub 查询。
- 不照搬 `syncedAt` 语义。Pie 若承诺“最后成功核验”，需要与上游“内容变化才写盘”的行为区分。

### 与已有提案的关系

初版草案中的“daemon 存活就同步”“零 Renderer 启动即发现”已被新设计移除。现方案明确：Agent 尽早登记但不额外查询 GitHub；用户实际查看时才核验状态、拓扑与详情，需求结束后停止周期查询。手动添加关联 UI 暂缓，取消关联作为纠正入口保留。

分支自动关联也是产品选择：t3code 区分 branch candidate 与 explicit link；Pie 原提案选择可信分支发现后自动持久关联。可以保留 Pie 的选择，以满足侧栏不点击 Session 也能发现的目标，但必须坚持共享目录的归属校验，不能误称为完整照搬 t3code。

## 8. 验证与限制

已通过 `/tmp/t3code-pull-request-model-probe.mjs` 用 Node 的 TypeScript stripping 执行上游实际共享函数及其 URL / 仓库规范化依赖，未重写算法。8 项检查通过：

- derived chain 按 base/head 而非编号 / 输入顺序排列；
- 无关的多 open PR 虽进入内部 current stack 集合，但没有 Stack badge；
- native 层序优先；
- dismissed 成员保留但隐藏；
- 环不猜排序；
- 重复 head 不猜父层；
- 完成的单链仍指向顶层；
- 未同步关联不丢失，并参与保守的 open 聚合。

另阅读了上游 [共享模型测试][shared-tests] 与 [同步器测试][sync-tests]，确认其中覆盖请求去重、错误保留、15 分钟 reopen、Stack 失败重试、在途刷新 generation、自动成员补齐和 dismissed 防复活。**未运行上游完整测试套件、未启动 t3code UI、未在真实 GitHub 上创建或修改 Stack。**

[contracts]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/packages/contracts/src/orchestration.ts#L620-L729
[shared]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/packages/shared/src/threadPullRequests.ts
[migration]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/server/src/persistence/Migrations/050_ProjectionThreadPullRequests.ts
[decider]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/server/src/orchestration/decider.ts#L1012-L1143
[projection]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/server/src/orchestration/Layers/ProjectionPipeline.ts#L858-L932
[user-docs]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/docs/user/source-control.md#L131-L165
[linking]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/web/src/hooks/usePullRequestLinking.ts
[created]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/server/src/git/linkCreatedPullRequest.ts
[agent-tools]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/server/src/mcp/toolkits/pullRequests/handlers.ts
[instructions]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/server/src/provider/RuntimeInstructions.ts
[discovery]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/server/src/orchestration/ThreadPullRequestReactor.ts
[sync]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/server/src/orchestration/PullRequestSyncReactor.ts
[cli]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/server/src/pullRequest/GitHubPullRequestCli.ts#L1857-L1925
[stack-json]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/server/src/pullRequest/gitHubPullRequestJson.ts#L2520-L2592
[indicators]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/web/src/components/ThreadStatusIndicators.tsx
[panel]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/web/src/components/pullRequest/ThreadPullRequestsPanel.tsx
[settlement]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/server/src/orchestration/ThreadSettlementPolicy.ts
[ws]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/server/src/ws.ts#L2526-L2612
[activation]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/server/src/serverActivation.ts
[actions]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/server/src/pullRequest/gitHubStackActions.ts
[service]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/server/src/pullRequest/PullRequestService.ts#L1682-L1800
[shared-tests]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/packages/shared/src/threadPullRequests.test.ts
[sync-tests]: https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/server/src/orchestration/PullRequestSyncReactor.test.ts
[pie-design]: ../design/session-pull-request-sync.md
