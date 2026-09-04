# Claude Code / Grok Build：workflow 能力调研

- **Date:** 2026-08-26
- **Scope:** Anthropic Claude Code（CLI / Desktop / IDE / web / Agent SDK）与 xAI Grok Build（TUI / headless / ACP）的编排层。不是模型本身的推理能力。
- **Question:** 两边所谓的 workflow 分别指什么，谁拿着计划，能编排到什么规模，以及 pie 如果要接或对齐，该接哪一层。

## 结论

两边在 2026 年夏天几乎同时把「编排」做成了产品。Anthropic 在 5 月底给 Claude Code 加了 Dynamic Workflows；xAI 随后在 Grok Build 里做了几乎同形的一层。产品形状已经收敛：模型写一段编排脚本，运行时在后台按脚本 spawn 子 agent，会话本身保持可交互，跑完交一份结果，脚本可以存成 slash command 再跑。

不要把这个词跟日常「开发流程」混在一起。Claude Code 文档里至少有四层都能跑多步任务，差别是**谁拿着下一步**：

| 层 | 是什么 | 谁决定下一步 | 中间结果放哪 | 可重复的是什么 |
| --- | --- | --- | --- | --- |
| Subagents | 主会话 spawn 的工人 | 模型，一回合一回合 | 主会话上下文 | 工人定义 |
| Skills | 模型要遵守的说明书 | 模型，跟着 prompt | 主会话上下文 | 说明书 |
| Agent teams（Claude，实验） | lead + 对等会话 | lead，一回合一回合 | 共享任务列表 | 团队定义 |
| Dynamic workflows | 运行时执行的脚本 | **脚本** | **脚本变量** | **编排本身** |

Grok Build 公开树里没有 agent-teams 那种对等会话。后台 fan-out、校验、一份结果，都收进 workflows。Grok Bot 不在这棵树里，不能拿它当本地编排的对等物。

对 pie 最有用的判断：pie 现在的会话模型是「一条 transcript + 一个 live runtime」。Workflow 跑的是**会话外的一批子 agent**，进度不该折进主 chat。如果以后要接 Claude Code 或 Grok Build 的这一层，需要独立的 run 对象、phase/agent 进度事件、以及和主 session 分开的许可面。现在仓库里没有 workflow 这个词，也没有对应 RPC。

## 调研范围与方法

Grok Build 以源码为准。读的是 [xai-org/grok-build](https://github.com/xAI-org/grok-build) 在 `77cd7eb675ba911c225c3aaeeece3a20cbccc426`（2026-08-25 `Synced from monorepo`）的树。仓库声明自己是内部 monorepo 的定期同步，所以这是公开树上的实现，不是已安装二进制的证明。

主路径：

- `crates/codegen/xai-workflow/`：Rhai 引擎、journal、meta、validate
- `crates/codegen/xai-grok-shell/src/session/workflow/`：manager、registry、host、tracker、store
- `crates/codegen/xai-grok-tools/src/implementations/grok_build/workflow/mod.rs`：`workflow` 工具
- `crates/codegen/xai-grok-shell/src/session/workflows/deep_research.rhai`：唯一编进二进制的 workflow

Claude Code 没有同等公开 harness 源码，那一半仍按 2026-08-26 的 [code.claude.com/docs](https://code.claude.com/docs/en/workflows) 写，并标明。没跑过本机 `claude` / `grok`。

## 先把名词拆开

「workflow」在两边文档里至少指三件不同的事。混用会把结论写歪。

1. **Dynamic / scripted workflow。** 本文的主对象。一段可执行编排（Claude 是 JavaScript，Grok 是 Rhai），由独立 runtime 跑，主会话只拿最终结果。
2. **Skill / slash command 意义上的「可复用流程」。** 一份 markdown 说明书，模型跟着做。Claude 的 skills 走 [Agent Skills](https://agentskills.io) 标准；Grok 读同一套 `SKILL.md`，也扫 Cursor / Claude / `~/.agents/`。
3. **日常开发流程。** Claude 的 [common-workflows](https://code.claude.com/docs/en/common-workflows) 是「怎么用这个工具修 bug」，不是编排运行时。

另外还有几层容易被叫成 workflow，但官方不这么归类：

- Claude：`/loop` 与 cron、Desktop scheduled tasks、云端 routines、`/goal`、channels、agent view、`/batch`
- Grok：`/loop`、monitors、prompt queue、plan mode、Grok Bot routines

下文先写脚本编排，再写外围自动化。

## Claude Code：编排栈

### 扩展层怎么叠

[Extend Claude Code](https://code.claude.com/docs/en/features-overview) 把扩展钉在 agentic loop 的不同位置：

- `CLAUDE.md`：每场会话都看见的项目约定
- Skills：可复用知识或可调用流程；`/` 触发，或模型自己选
- Subagents：隔离上下文，只回摘要
- Dynamic workflows：模型写脚本，后台跑许多 subagent，回一份结果
- Cross-session messaging：你自己开的两个会话互相传话
- Hooks：生命周期上跑脚本 / HTTP / MCP / prompt / subagent
- MCP：接到外部系统
- Plugins + marketplaces：把上面几样打包分发

文档给的升级顺序很具体：约定写错两次就进 `CLAUDE.md`；同一段 prompt 打第三次就存成 skill；旁路任务淹没主对话就丢给 subagent；「每次都要发生」写成 hook；第二份仓库需要同一套配置再打成 plugin。Dynamic workflow 出现得更晚：工作已经大过「几个 subagent」，或者你要交叉校验再看结果。

### Subagents

工人。主会话 spawn，各自上下文，回摘要。[内置 Explore / Plan 启动时跳过 `CLAUDE.md` 和 git status](https://code.claude.com/docs/en/sub-agents)，就是为了把上下文压小。Skill 可以 `context: fork` 丢给指定 agent type；反过来，自定义 subagent 也能 preload skills。

`/batch` 不是第四种协调方式。它是 skill：把一次大改拆成 5 到 30 个 worktree 隔离的 subagent，各自开 PR。

### Agent view

研究预览。`claude agents` 打开一张屏，派发并监视后台会话。独立任务你想交出去、扫一眼状态、只在需要时介入时用。Agent view 派出去的会话会自动进各自 worktree。

### Agent teams

实验，默认关。要 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`。[官方自己写了](https://code.claude.com/docs/en/agent-teams)：恢复、任务协调、关机行为都有已知问题。

和 subagent 的差别是通信拓扑。Subagent 向调用者交卷。Teammate 共享任务列表，直接互相发消息，你也可以不经过 lead 跟某个 teammate 说话。Token 更贵：每个 teammate 是独立 Claude 实例。非交互 `-p` 和 Agent SDK 即使开了 flag 也不会 spawn teammate，只会当普通 subagent。

文档明确写了：agent teams **不会**给 teammate 做 worktree 隔离，分区文件是调用方的责任。

### Dynamic workflows

[官方页](https://code.claude.com/docs/en/workflows)。要 Claude Code v2.1.154+。付费计划、Anthropic API、Bedrock、Google Cloud Agent Platform、Microsoft Foundry 都能用。Pro 要在 `/config` 的 Dynamic workflows 行打开。

核心设计：模型写出一段 JavaScript，runtime 在隔离环境执行。脚本不能碰文件系统和 shell，也不能 `import()`。干活的是它 spawn 的 agent。中间结果停在脚本变量里，主上下文只拿最终答案。会话保持可交互。

触发方式：

- prompt 里写 `ultracode`，或「use a workflow / run a workflow」。v2.1.160 之前字面触发词是 `workflow`
- `/effort ultracode`：`xhigh` 推理 + 每个实质性任务都规划 workflow。一句话可以连着开好几个：理解代码、改、验
- 已保存的 command，或内置 `/deep-research`

`ultracode` 关键字只认你亲手打的、origin 标成 human 的输入。`-p`、SDK 未盖章的 prompt、scheduled task、webhook、PR 评论都不会因此开跑。v2.1.210 之前这些路径也会触发。

内置 `/deep-research`：多角度搜、抓源、交叉校验、对 claim 投票，没挺过校验的不进报告。校验失败（限流、API 错）标 unverified，不当成驳倒。

保存位置：

- 项目：`.claude/workflows/`
- 个人：`~/.claude/workflows/`（或 `$CLAUDE_CONFIG_DIR/workflows/`）
- plugin：`workflows/`，命令带插件名前缀，例如 `/acme-tools:release-audit`

同名时项目覆盖个人。monorepo 从 cwd 走到 repo root，每个已有的 `.claude/workflows/` 都会加载，最近的赢。保存时拒写 symlink。

运行时约束（官方表）：

| 约束 | 原因 |
| --- | --- |
| 跑到一半不能问用户 | 只有 agent 的许可提示能暂停。阶段之间要签字，就拆成多次 workflow |
| 脚本自己不能碰 FS / shell | agent 读写和跑命令，脚本只协调 |
| 禁止 `import()` | 正文是纯 JS。要库就放进某个 agent 的任务 |
| 同时最多 16 个 agent，CPU 少还会再砍 | 限制本机资源 |
| 同一次 fan-out 里共享 prompt-cache 前缀的 agent，默认最多晚 5 秒启动 | 让后续请求打到第一个 agent 写下的 cache |
| 单次 run 总共 1000 个 agent | 防止失控循环 |

`/workflows` 能看 phase、agent 数、token、耗时；能暂停、停单个 agent、重启、把脚本存成 command。超过 25 个 agent 或预计 150 万 token 会标 `Large workflow`，只警告不停。ultracode 开着不警告。`workflowSizeGuideline`（v2.1.202+）给模型一个规模建议：`small` < 5、`medium` < 15、`large` < 50，默认 `medium`。这是建议不是硬顶，runtime cap 仍然生效。

许可：CLI 里按 permission mode 决定要不要先看 phase 列表。Auto 模式第一次同意后记住；ultracode 开着连这次也不问。workflow spawn 的 subagent **一律 `acceptEdits`**，继承你的 tool allowlist。文件编辑自动过。不在 allowlist 里的 shell / fetch / MCP 仍可能中途弹窗。

恢复：同一会话内可 resume。已完成的 agent 通常走缓存。仍在跑的不保存。回放按启动顺序，第一个没跑完的之后全部重跑，哪怕它们当时已经完成。所以「很多小 agent」比「一个很长的 agent」更经得起中断。退出 Claude Code 再开，workflow 从头来。

官方给的适用形状：按文件审计、修到检查通过、并行迁移、按变更文件 review 再汇总、多源调研、重复找 flake 直到列表不再涨。脚本形状是 `agent()` + `pipeline()`：

```javascript
export const meta = {
  name: 'audit-routes',
  description: 'Audit every route handler for missing auth checks',
}

const found = await agent('List every .ts file under src/routes/.', {
  schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } },
})

const audits = await pipeline(found.files, file =>
  agent(`Audit ${file} for missing authentication checks.`, { label: file }),
)

return audits.filter(Boolean)
```

`agent()` 中途被停或遇到不可恢复 API 错会变成 `null`。`pipeline()` 保留这些 `null`，所以示例最后 `filter(Boolean)`。

### 定时与云端，不是同一层

| | Cloud routines | Desktop scheduled tasks | `/loop` |
| --- | --- | --- | --- |
| 跑在哪 | 云，默认 Anthropic 管 | 你的机器 | 你的机器 |
| 要机器开着吗 | 否 | 是 | 是 |
| 要开着会话吗 | 否 | 否 | 是 |
| 重启后还在吗 | 是 | 是 | `--resume` 且未过期才回来 |
| 本地文件 | 否（新 clone） | 是 | 是 |
| 最短间隔 | 1 小时 | 1 分钟 | 1 分钟 |

`/loop` 是会话作用域，最多 50 个，7 天过期。Routines 是 research preview：一份存好的 prompt + 仓库 + connectors，用 schedule / API / GitHub 事件触发。跑的时候没有许可选择器。Team / Enterprise Owner 可以整组织关掉。

`/goal` 是另一条轴：设完成条件，模型一直做到满足、判断不可能、或遇到必须你修的错。Channels 是推事件进会话，不是轮询。

## Grok Build：编排栈

Grok Build 是 xAI 的终端 coding agent，SuperGrok / X Premium Plus 可用，Grok 4.6 驱动。[产品页](https://x.ai/cli) 和 [docs overview](https://docs.x.ai/build/overview) 把它定位成 TUI、headless（`-p`）、以及 ACP 三种入口。

### 兼容层（源码）

`xai-grok-tools/src/types/compat.rs` 自己写：历史上目录列表 `[".grok", ".agents", ".claude", ".cursor"]` 散落在三个 crate 的大约 6 个调用点。现在由这个模块当唯一注册表。解析链是 env → config TOML → remote setting → **默认开**。

`COMPAT_CELLS` 有 18 格。Cursor / Claude 各覆盖 skills、rules、agents、mcps、hooks、sessions。Codex 只有 sessions 默认开，skills / rules / agents / mcps / hooks 那几格默认关。`agents_md_tracker.rs` 把 `CLAUDE.md` 和 `.claude/CLAUDE.md` 列进发现名单。这是读 Claude 约定的实现，不是文档承诺。

兼容层扫的是 skills / hooks / MCP / agents / `CLAUDE.md`。workflow 文件不在这份名单里。registry 只认 `.rhai`，不会去读 `.claude/workflows/`。

### Subagents

workflow 子调用的默认 `agent_type` 是 `general-purpose`（`host.rs`）。`capability_mode` 才是脚本侧的权限旋钮：`read-only` / `read-write` / `execute` / `all`。`deep_research.rhai` 把 planner / researcher / verifier 都钉成 `read-only`。内置 explore / plan 的产品说明在文档里，本树的 workflow 路径不靠那两个类型。

### Workflows（源码）

树在 `77cd7eb`。实现分三层：`xai-workflow` 跑 Rhai；`session/workflow` 管 run 生命周期；`GrokBuild:workflow` 工具是模型的入口。工具描述写明：调用立刻返回，进度走 `/workflow runs`，完成会自动通知，不要 poll。

开关在 `resolve_workflows()`：远端 `workflows_enabled == false` 最高优先，然后 `GROK_WORKFLOWS`，然后 `[workflows] enabled`，默认 `true`。关掉时 launch 通道直接 `workflows_disabled`。子 agent 启动时 `is_subagent` 也不会带上这个工具。子 session 按 kind 或短 id 剥掉 `workflow`，所以脚本里的孩子不能再开 workflow。

**脚本契约。** 第一句必须是 `let meta` 或 `const meta`。`meta.name` 是 kebab-case（小写字母数字，单连字符，不能打头或收尾）。未知 meta 字段直接拒。名字最多 64 字节，phases 最多 64 个且 title 不能重复。引擎关了 `eval` 和模块加载；`timestamp()`、`sleep()`、`exit()` 会报错。`timestamp` 的错误写得很白：墙钟时间会破坏 resume，时间从 `args` 传入。结束用 `complete(value)` 或 `pause(kind, msg)`。`await_user` 会先记 journal 再 pause，resume 时跳过这道门。

宿主函数（`engine.rs` `register_host_fns`）：`agent`、`parallel`、`phase`、`log`、`telemetry_event`、`complete`、`pause`、`await_user`、`budget`、`render_template`、`write_scratch_file`、`read_scratch_file`、`git_diff_since`、`fingerprint`、`json_encode`。没有 Claude 那种 `pipeline()`；fan-out 就是 `parallel([#{ prompt, ... }, ...])`。

`agent` 的 opts（`host.rs` `AgentOpts`）：`prompt`、`label`、`model`、`effort`、`max_output_tokens`（host 忽略，只打 debug）、`agent_type`（默认 `general-purpose`）、`capability_mode`（`read-only` / `read-write` / `execute` / `all`）、`isolation_worktree`、`fork_context`、`resume_from`、`output_schema`、`phase`。`fork_context` 只允许 builtin workflow；用户脚本要这个会 `Unsupported`。

**三个不是同一个数的「1024」。** `xai-workflow/src/lib.rs`：

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `DEFAULT_AGENT_BUDGET` | 128 | 逻辑子 agent 调用的默认上限 |
| `MAX_AGENT_BUDGET` | 1_024 | `agent_budget` 能设到的顶 |
| `MAX_PARALLEL` | 1_024 | 单次 `parallel()` 的 item 数 |
| `MAX_HOST_CALLS` | 10_000 | 带结果的宿主调用（含非 agent） |
| `WORKFLOW_MAX_ACTIVE_RUNS_PER_SESSION` | 4 | 一个 session 同时活着的 run（含 retiring） |

工具 schema 把 `agent_budget` 写成：「绝对累计上限。每个 `agent()` 和每个 `parallel()` item 占一格；schema retry 不占。1–1024，默认 128。会超预算的 panel 在任何孩子启动前整组拒绝。」

同时在跑几个是另一条轴。`DEFAULT_WORKFLOW_MAX_CONCURRENT_AGENTS = 32`，再和 `available_parallelism().max(2)` 取小。更宽的 `parallel()` 排队，仍然是 barrier。物理模型调用还可以再高：`SCHEMA_CONTRACT_RETRIES = 1`，`WORKFLOW_MAX_AGENT_RUNS = 1024 * (1+1) = 2048`。逻辑 budget 打满之后，structured-output 修一次还可以再跑一轮，不另占逻辑格。

**发现顺序。** `WorkflowRegistry::scan`：`~/.grok/bundled/workflows` → 编译进二进制的 builtin → 受信任项目下的 `.grok/workflows/` → `~/.grok/workflows/`。`merge_scope` 是先到先得。注释写明：项目/用户**不能**覆盖编译进二进制的名字。GCS 下发的 `deep-research.rhai` 可以影子 `include_str!`，但仍算 Builtin（保留 `fork_context` 特权，且不可 save）。同 scope 重名整组标 ambiguous 并丢掉。workflow 目录若是 symlink 直接跳过。按路径加载拒 symlink。文件名必须是 `<meta.name>.rhai`。源文件上限 1 MiB。

编进树的 builtin 只有一个：`deep-research`。`create-workflow` 是平台 skill（`builtin.rs` 里有 hash），本树没有它的 `SKILL.md`。

**Resume 是同进程 journal 回放，不是云作业。** journal 在 `session_dir/workflows/<run_id>/journal.jsonl`，按 `seq` 密集编号，回放对 `kind + req_hash`。脚本中途改了会 `Divergence`。resume 时脚本和 args 不可变；`LaunchError` 在 args 对不上时直接拒。工具 schema 原文：「Process-restart interruptions are terminal。」

`WorkflowRunStatus::is_resumable`：paused 全家、`Failed`、`Cancelled` 可 resume。`Complete` 和 `Interrupted` 不行。`/workflow stop` 的 Cancelled 留着 journal，按 pause 同一条路续。`BudgetLimited` 只有传入更高的 `agent_budget` 才能续；已经用到 `MAX_AGENT_BUDGET` 就只能新开。`Failed` resume 会 `prune_trailing_host_error`。journal 上限 64 MiB / 10000 条，写满会拒，避免不可 resume 的半截。

**`deep_research.rhai`。** 默认 `breadth = 4`，`args.breadth` 夹在 2–6。四段：Plan / Research / Verify / Report。planner、researcher、verifier 都是 `capability_mode: "read-only"`。每个 researcher 最多 6 条 claim；候选池 24。verifier 按 `claim_idx % verifier_count` 分片，1 或 2 个 shard，**每条 claim 只给一个 verifier**。shard 输出对不上 expected IDs 就整片作废。`supported == true` 还要非空的 `evidence` / `source_title` / `source_locator`。报告写进 scratch `report.md`。默认成功路径大约 1 个 planner + ≤4 个 researcher + 1–2 个 verifier + 1 个 synthesizer，远小于 128。

scratch：每 run 最多 64 个文件，单文件 10 MiB，合计 64 MiB。脚本 telemetry 最多 64 条。agent prompt 上限 1 MiB。

### 工作区隔离（workflow 相关）

`AgentOpts.isolation_worktree` 会传到 `host_service.rs`。子 agent 可以要独立 checkout。会话级 worktree（`grok -w`、`~/.grok/worktrees/`、`gc`）在 `session/worktree.rs` 和 `extensions/worktree.rs`，跟 workflow run 不是同一条对象。resume 会话会走 `create_worktree_for_resume`，检测 jj 还是 git。

后台任务、`/loop`、Plan mode、ACP 的产品页不在这条调研的源码路径里。ACP spawn 只核对过一件事：`background_workflows_enabled == false` 时 launch 直接拒，错误字符串点名 `[workflows] enabled` / `GROK_WORKFLOWS=0` / remote flag。

### Grok Bot

公开树里搜不到 Grok Bot / cloud routines 的实现。那是另一条产品线，不是本地 `.rhai` 编排。Claude 对应的是 routines + Claude Code on the web，不是 Dynamic Workflows。这段不再用 changelog 当依据。

## 对照

### 脚本编排这一层

| | Claude Code Dynamic Workflows（文档） | Grok Build Workflows（`77cd7eb` 源码） |
| --- | --- | --- |
| 脚本 | JavaScript，`agent()` + `pipeline()` | Rhai，`agent()` + `parallel()` |
| 谁写脚本 | 模型写；你可事后看、存、改 | 模型经 `workflow` 工具写；`validate_only` 做 smoke-check |
| 内置 | `/deep-research` | 编译进树的只有 `deep-research` |
| 保存 | `.claude/workflows/`、`~/.claude/workflows/`、plugin | `.grok/workflows/`、`~/.grok/workflows/`；builtin 名不可被项目影子 |
| 规模 | 同时 16，总计 1000 | 逻辑 128–1024；同时默认 32 再按 CPU clamp；每 session 最多 4 个 run |
| 物理调用 | 文档未拆 retry | schema retry 1 次，物理上限 2048 |
| 恢复 | 同会话；进程退出即丢 | 同进程 journal；工具写明进程重启即终止 |
| 中途问人 | 不行（只能拆成多次 workflow） | `await_user` / `pause`；resume 跳过已记录的 await |
| 子 agent 再开 workflow | 文档未写死 | 从子 session 工具表剥掉 |
| `fork_context` | skill `context: fork` | 仅 builtin |
| 关 | `disableWorkflows` / env | 远端 flag > `GROK_WORKFLOWS` > `[workflows] enabled`，默认开 |

产品形状同形，量纲不同。Claude 文档把并发和总计写在一起。Grok 源码把逻辑 budget、同时在跑、每 session 的 run 数、物理 retry 拆开。新闻稿里的「1024 agents」在树上是累计逻辑调用，不是 1024 路同时跑。

1. **脚本是可审的。** Grok 的 API 在 `engine.rs` / `host.rs`，bundled 脚本在仓库里。Claude 的 JS 示例在文档里，harness 不公开。
2. **花费。** Claude 有 size guideline 和 150 万 token 警告。Grok 硬顶的是逻辑调用和 32 路并发，没有 workflow 级 token / 美元 cap。`max_output_tokens` 被忽略。
3. **恢复。** 两边都不是云队列。Grok 把这句话写进工具 schema：进程重启即终止。
4. **格式。** `.js` 和 `.rhai` 不能互换。Grok 读 Claude 的 skills / hooks / MCP，不读 Claude 的 workflows。
5. **谁拿着计划。** 两边都把循环从模型上下文挪进 runtime。Grok 还多了 `await_user`，所以脚本可以在阶段之间停下来等人，而不必拆成两次 run。

### 整栈，不只 workflow

Claude 栏仍是文档。Grok 栏里 workflows、compat 格、`isolation_worktree` 对过源码。marketplace、`/fork`、`/loop`、Plan mode、Grok Bot 没对。

| 能力 | Claude Code | Grok Build |
| --- | --- | --- |
| 项目约定 | `CLAUDE.md`、`.claude/rules/` | `AGENTS.md` + 自动读 Claude / Cursor |
| Skills | Agent Skills 标准 + fork / hooks 扩展 | 同形 `SKILL.md`，扫三套目录 |
| Hooks | 事件面很宽：session / turn / tool / HTTP / prompt | 生命周期脚本；项目 hooks 要 `/hooks-trust` |
| MCP | 一等 | 一等 |
| Plugins / marketplace | 有 | 有；并读 Claude marketplace |
| Subagents | 自定义 + Explore / Plan | `general-purpose` / `explore` / `plan` + personas |
| 对等协作 | Agent teams（实验）、cross-session messaging | `/fork`、Agent Dashboard |
| 脚本编排 | Dynamic workflows | Workflows |
| Worktree | 有；agent view 自动隔离 | 有；subagent 可要 |
| 会话内定时 | `/loop`、cron tools | `/loop`、monitors |
| 机器级定时 | Desktop scheduled tasks | 未见对等文档 |
| 云端无人值守 | Routines（preview） | Grok Bot routines |
| 嵌进别人的编排器 | Agent SDK | ACP + `-p` |
| 计划先于编辑 | Plan 相关能力（ultraplan 等） | Plan mode，批准前锁文件编辑 |

Grok 的策略很清楚：做成 Claude Code 配置的超集，再在编排语言和云队友上走自己的。Claude 的策略是把同一问题拆成更多层（teams / view / messaging / routines / goal / channels），每层文档更厚，实验开关也更多。

## 什么任务真的适合脚本编排

两边的例子都偏向 **map-reduce**：按文件 / issue / 路由 / 假设切开，只读检查，独立校验，去重，合成一份报告。PR review、issue triage、缺认证审计、竞品调研、flake 搜集，都是这个形状。

弱的形状也对称。共享状态上的编辑、步骤严格依赖前一步的迁移、事故响应里的现场判断，都不该先上百个 agent。Claude 自己写：workflow 中途不能问用户；要阶段签字就拆成多次。Grok 的 `/create-workflow` 会先问校验和范围，也是在逼你承认「校验是拓扑的一部分，不是礼貌」。

`/deep-research` 两边都内置，都不是「搜得越多越好」。Claude 文档写交叉校验和投票。Grok 的 `deep_research.rhai` 默认广度 4，完整成功路径大约 4–8 次逻辑调用。平台天花板是 1024；捆绑脚本是个位数。verifier 是分片排斥，不是双人投票：一条 claim 只进一个 shard。

## 对 pie 的含义

pie 当前会话域（`CONTEXT.md`、`packages/server/src/harness/`）按 **一条 SessionRef、一个 Pi runtime、一份 transcript** 建模。仓库里搜不到 workflow 这个产品对象。既有的 Claude Code 研究（`docs/research/2026-07-16-claude-code-history-messageid.md`）处理的是 **turn 级 messageId**，不是后台 run。

如果 pie 只继续包 Pi，这篇调研的直接动作是：不要在 pie 里发明第四套「skill / hook / command」词汇。外面已经收敛成 Agent Skills + hooks + 脚本编排。Pi 侧如果以后要有可复用流程，优先 skill，不要先做 `.rhai` / `.js` runtime。

如果 pie 要接 Claude Code 或 Grok Build 当 harness（设计文档里已经出现过 `claude-code` adapter），workflow 会撞上几条现有不变量：

1. **Run 不是 turn。** 主会话在 workflow 跑的时候仍然能说话。进度是 phase / agent / token，不是 assistant message。不能把这些折进现在的 `session.turn.ended` 边界。
2. **事件面要多一个对象。** 至少要有 `workflow.started|progress|paused|resumed|stopped|finished`，payload 带 run id、phase、agent 计数、token。订阅模型今天是按 SessionRef。workflow 挂在 session 下还是并列，要单独定。
3. **许可面是第二次提示。** Claude 把「启不启动这场 fan-out」和「子 agent 能不能改文件」分开。pie 现在的 agent-request 通道是为工具调用准备的。一场 50 agent 的 run 如果每个 shell 都冒泡，UI 会不可用。
4. **历史冷读。** Claude 文档有 `getSubagentMessages` / `listSubagents`。Grok 的 journal 在 `session_dir/workflows/<run_id>/journal.jsonl`，tracker 另记 roster。pie 的 getMessages 路径（wayfinder ticket 10）还没走到这一层。
5. **配置发现。** Grok 扫 `.claude/` 和 `.cursor/`（compat 开关，默认开）。pie 如果做 skill 安装，发现路径要按「多 harness 共读同一份仓库约定」来设计。workflow 文件不要指望能共用：Grok 的 registry 只认 `.rhai`。

不建议现在实现 workflow runtime。建议先把词汇表写进 `CONTEXT.md` 的避免列表：pie 自己的词继续用 session / turn / worktree；提到 Claude / Grok 时把 workflow 特指「脚本编排的后台 run」，不要用来形容 skill 或日常开发流程。

## 没核实的部分

- 没跑过本机编译出的 `xai-grok-pager`。源码是公开树，不是已安装二进制。xAI 说这个仓库是 monorepo 定期同步。
- `create-workflow` skill 的 `SKILL.md` 不在这个树里，只有 hash。作者指南以工具描述里的那句 “read the create-workflow skill” 为准，正文没读到。
- Grok Bot / cloud routines 不在这棵树里。后台任务、`/loop`、Plan mode、marketplace 安装路径没对源码。
- Claude Code 一半仍是文档。没对过 Agent SDK 的 Workflow tool 类型。
- 没比 Codex。没查 pie 内部决策记录。

## 来源

Grok Build，[xai-org/grok-build](https://github.com/xAI-org/grok-build) @ `77cd7eb675ba911c225c3aaeeece3a20cbccc426`：

- `crates/codegen/xai-workflow/src/lib.rs`
- `crates/codegen/xai-workflow/src/engine.rs`
- `crates/codegen/xai-workflow/src/host.rs`
- `crates/codegen/xai-workflow/src/journal.rs`
- `crates/codegen/xai-workflow/src/meta.rs`
- `crates/codegen/xai-workflow/src/run.rs`
- `crates/codegen/xai-grok-shell/src/session/workflow/manager.rs`
- `crates/codegen/xai-grok-shell/src/session/workflow/registry.rs`
- `crates/codegen/xai-grok-shell/src/session/workflow/host_service.rs`
- `crates/codegen/xai-grok-shell/src/session/workflow/tracker.rs`
- `crates/codegen/xai-grok-shell/src/session/workflow/schema_contract.rs`
- `crates/codegen/xai-grok-shell/src/session/workflows/deep_research.rhai`
- `crates/codegen/xai-grok-tools/src/implementations/grok_build/workflow/mod.rs`
- `crates/codegen/xai-grok-shell/src/agent/config.rs`（`resolve_workflows`）
- `crates/codegen/xai-grok-shell/src/session/acp_session_impl/spawn.rs`（disabled 拒绝）
- `crates/codegen/xai-grok-tools/src/types/compat.rs`（vendor 兼容格，默认开）
- `crates/codegen/xai-grok-tools/src/types/agents_md_tracker.rs`（`CLAUDE.md` 发现）

Claude Code（文档，无公开 harness 树）：

- https://code.claude.com/docs/en/workflows
- https://code.claude.com/docs/en/agents
- https://code.claude.com/docs/en/features-overview
- https://code.claude.com/docs/en/agent-teams
- https://code.claude.com/docs/en/scheduled-tasks
- https://code.claude.com/docs/en/routines
