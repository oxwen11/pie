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

Grok Build 没有公开的 agent-teams 对等物。它把「后台 fan-out + 校验 + 一份结果」收进 workflows，把「对等会话协作」收进 `/fork`、Agent Dashboard 和云端 Grok Bot。

对 pie 最有用的判断：pie 现在的会话模型是「一条 transcript + 一个 live runtime」。Workflow 跑的是**会话外的一批子 agent**，进度不该折进主 chat。如果以后要接 Claude Code 或 Grok Build 的这一层，需要独立的 run 对象、phase/agent 进度事件、以及和主 session 分开的许可面。现在仓库里没有 workflow 这个词，也没有对应 RPC。

## 调研范围与方法

读的是 2026-08-26 当天的官方文档，不是本地装过的 CLI。

- Claude Code：[workflows](https://code.claude.com/docs/en/workflows)、[agents](https://code.claude.com/docs/en/agents)、[sub-agents](https://code.claude.com/docs/en/sub-agents)、[agent-teams](https://code.claude.com/docs/en/agent-teams)、[features-overview](https://code.claude.com/docs/en/features-overview)、[scheduled-tasks](https://code.claude.com/docs/en/scheduled-tasks)、[routines](https://code.claude.com/docs/en/routines)、[docs index](https://code.claude.com/docs/llms.txt)
- Grok Build：[overview](https://docs.x.ai/build/overview)、[modes-and-commands](https://docs.x.ai/build/modes-and-commands)、[subagents](https://docs.x.ai/build/features/subagents)、[skills / plugins / marketplaces](https://docs.x.ai/build/features/skills-plugins-marketplaces)、[worktrees](https://docs.x.ai/build/features/worktrees)、[background-tasks](https://docs.x.ai/build/features/background-tasks)、[settings](https://docs.x.ai/build/settings/reference)、[cli](https://x.ai/cli)、[docs index](https://docs.x.ai/llms.txt)
- 产品页：[Grok Build 发布](https://x.ai/news/grok-build-cli)、[Workflows 发布](https://x.ai/news/workflows)（2026-07-23）

没跑过 `claude` / `grok` 本体。Grok 没有独立的 `/build/features/workflows` 页面（404）。部分运行时数字来自对公开源码快照的二次分析，单独标成推断。

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

### 兼容层是设计，不是事后补丁

[Skills / plugins 页](https://docs.x.ai/build/features/skills-plugins-marketplaces) 写得很硬：Grok 零配置读 Claude Code 的 marketplaces、plugins、skills、MCPs、agents、hooks，以及 `CLAUDE.md` / `Claude.md` / `CLAUDE.local.md` / `.claude/rules/`，同时也读 `AGENTS.md` 家族和 `~/.agents/skills|commands/`。设置里有一整组 `GROK_CURSOR_*` / `GROK_CLAUDE_*` 开关，默认全开。TUI 还有 `/import-claude`。

Skill frontmatter 和 Claude 几乎同形：`name`、`description`、`when-to-use`、`paths`、`allowed-tools`、`argument-hint`、`user-invocable`、`disable-model-invocation`。Grok 接受但不应用 `model`、`effort`、`license`、`compatibility`。`allowed-tools` **不授予也不限制**工具，这点和「写了就收权」的直觉相反。

### Subagents

[官方页很短](https://docs.x.ai/build/features/subagents)。内置三类：`general-purpose`（完整能力）、`explore`（只读，无 shell / 编辑）、`plan`（写计划，无 shell / 编辑）。自定义放 `.grok/agents/` 或 `~/.grok/agents/`。Personas 只覆盖语气和契约，不是另一种 agent。

环境变量 `GROK_SUBAGENTS` 默认写的是 `0`，文档又说「unset 时默认开」。以 `[subagents] enabled` 和 unset 行为为准，不要只看这个 env 默认值。

### Workflows

官方没有独立 feature 页。能核对的是 [modes-and-commands](https://docs.x.ai/build/modes-and-commands) 和 2026-07-23 的 [x.ai/news/workflows](https://x.ai/news/workflows)。

命令面：

| 命令 | 做什么 |
| --- | --- |
| `/create-workflow [description]` | 写并保存一份新 workflow。Grok 会问 fan-out、校验、范围，然后作者、smoke-check、落盘 |
| `/workflow <name> [args]` | 启动已保存的，或 `pause` / `resume` / `stop` / `save` |
| `/workflows` | 全屏 run dashboard。列的是正在跑和保留的 run，不是磁盘上的文件 |
| `/deep-research <query>` | 内置调研 workflow |

落盘：项目 `.grok/workflows/<name>.rhai`，或个人 `~/.grok/workflows/<name>.rhai`。启动可带 JSON args：

```text
/create-workflow Review the current branch for bugs, then verify each finding
/workflow review-changes {"target":"origin/main...HEAD"}
/workflow pause review-changes
```

关掉：`~/.grok/config.toml` 里 `[workflows] enabled = false`，或 `GROK_WORKFLOWS=0`。默认开。

[新闻页原文](https://x.ai/news/workflows) 的产品承诺：

- 用自然语言描述大任务，Grok 写成带 phase 的脚本，后台 fan-out「数百」个并行 agent，会话保持空闲
- 「Runs get a budget of 128 agents, and up to 1,024 for big jobs」
- 「Progress is saved as the run goes, so pausing and resuming never redoes finished work」
- `/workflows` 按 phase 看进度和每 agent 的 token
- Grok 写脚本、启动前 smoke-check、跑之间会改；「you never write the script yourself」
- 项目 `.grok/workflows/` 跟仓库走，个人 `~/.grok/workflows/` 跟人走；存下来的变成带参数的 slash command（示例：`/pr-review 5137`）
- 内置 `/deep-research`：并行调查、按源校验 claim、交带引用的报告

这些数字和 Claude 官方表不是同一量纲。Claude 写的是**同时并发 16、单次总计 1000**。Grok 公开写的是**budget 128–1024**，没有同时在跑几个的官方数。二次分析（对公开源码快照）还说：每会话最多 4 个活跃 workflow、workflow 不能嵌套、resume 只活在同一进程里、CLI 重启后中断的 run 算终止。这些没有出现在 `docs.x.ai` 或新闻页里，当推断，不要当 SLA。

脚本语言是 Rhai，不是 JS。官方 docs 没给 `agent()` / `parallel()` 的 API。二次来源和一份公开的 `engine.rs` 快照显示宿主函数包括 `agent(prompt)` / `agent(prompt, opts)`，以及并行 fan-out；`eval`、模块加载、`sleep`、`exit` 被关掉。可信度低于 Claude 那份带 `pipeline()` 示例的官方页。

### 工作区隔离、后台、计划

[Worktrees](https://docs.x.ai/build/features/worktrees) 是一等能力。`grok -w` 在隔离 checkout 里开会话；subagent 做并行工作时也可以要 worktree。路径在 `~/.grok/worktrees/<repo>/<key>/`，从当前 HEAD 起，包含未提交改动。结束会话不会自动删 worktree，要自己 `grok worktree gc`。

[Background tasks](https://docs.x.ai/build/features/background-tasks) 把命令、subagent、monitor 从对话里拆出去。`Ctrl+G` 开任务窗，`Ctrl+B` 把前台命令降到后台。`/loop` 按间隔重跑 prompt（最短 60 秒，7 天过期，最多 50 个）。Monitor 把脚本的每一行打进对话，不适合高噪声日志。

Plan mode 和 permission mode 正交：`/plan` 或 `Shift+Tab` 进去之后，批准计划之前只能改计划文件。Auto 用分类器放行安全工具。Always-approve 跳过工具提示，deny 规则和 hooks 仍生效。

ACP：`grok agent stdio` 让外部 IDE / bot 当 Grok Build 的客户端。Headless `-p` 带 `streaming-json`。这是把 Grok 嵌进别的编排器的官方口，不是 Grok 自己的 workflow 脚本。

### Grok Bot

另一条产品线：云上持久电脑里的 teammate，带消息、审批、connectors、routines。[changelog](https://docs.x.ai/llms.txt) 2026 年 8 月条把它标成已可用。审批模型是「允许一次 / 拒绝 / 总是允许」，另有 Auto Review 规则。这是云端队友，不是本地 `.rhai` 编排。Claude 对应的是 routines + Claude Code on the web，不是 Dynamic Workflows。

## 对照

### 脚本编排这一层

| | Claude Code Dynamic Workflows | Grok Build Workflows |
| --- | --- | --- |
| 首次公开 | 2026-05-25 那一周的 changelog（v2.1 线，要 2.1.154+） | 2026-07-23 新闻页 |
| 脚本 | JavaScript，`agent()` + `pipeline()` | Rhai，`.rhai`；宿主 API 官方未文档化 |
| 谁写脚本 | 模型写；你可事后看、存、改 | 模型写；`/create-workflow` 会先问再 smoke-check |
| 内置 | `/deep-research` | `/deep-research` |
| 保存 | `.claude/workflows/`、`~/.claude/workflows/`、plugin | `.grok/workflows/`、`~/.grok/workflows/` |
| 调用 | `/<name>`，`args` 进脚本全局 | `/workflow <name> {json}` 或 `/<name>` |
| Dashboard | `/workflows` | `/workflows` |
| 规模（官方） | 同时 16，总计 1000 | budget 128，最高 1024（逻辑调用） |
| 规模建议 | `workflowSizeGuideline` | 未见对等设置 |
| 恢复 | 同会话；进程退出即丢 | 官方说已完成不重做；二次来源说同进程 journal |
| 许可 | 启动提示随 mode 变；子 agent 固定 `acceptEdits` | 文档没写 workflow 专用许可例外 |
| 关 | `/config`、`disableWorkflows`、`CLAUDE_CODE_DISABLE_WORKFLOWS` | `[workflows] enabled`、`GROK_WORKFLOWS=0` |
| 出现在 | CLI、Desktop、IDE、`-p`、Agent SDK | TUI 默认开；headless / ACP 是否完整暴露未写清 |
| 文档完整度 | 有独立页、约束表、示例脚本、恢复规则 | 一段命令说明 + 新闻稿 |

产品形状几乎是一份作业抄了两次。有意义的差别不在 1000 对 1024，而在：

1. **脚本能不能被团队审。** Claude 的 JS + 官方示例更好读。Grok 的 Rhai 更难在仓库外找到规范。
2. **花费能不能事先框住。** Claude 有 size guideline 和 `Large workflow` 警告。Grok 有更大的逻辑 budget，没有已发布的并发或预计 token 阈值。
3. **恢复是不是跨进程。** 两边官方都把 resume 限制在当前会话 / 当前进程。都不是云队列。
4. **脚本能不能带走。** Grok 读 Claude 的 skills / hooks / MCP / `CLAUDE.md`，但 workflow 文件格式不通用。`.js` 和 `.rhai` 是两套运营资产。
5. **谁先把「计划」从模型脑子里挪进代码。** 这是这一层真正的产品决定。模型当编排器时，每一步的中间结果都进上下文，打断就重来一回合。脚本当编排器时，循环和分支活在 runtime 里，模型上下文只收终局。

### 整栈，不只 workflow

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

`/deep-research` 两边都内置，而且都不是「搜得越多越好」。Claude 过滤没挺过交叉校验的 claim。Grok 新闻页同样强调独立 skeptics。二次来源里那份 `deep_research.rhai` 默认广度 4（2–6），完整路径大约 4–8 次逻辑调用：1 个 planner、最多 4 个只读 researcher、1–2 个 verifier shard、1 个报告。平台天花板是营销数字；捆绑脚本是生产形状。

## 对 pie 的含义

pie 当前会话域（`CONTEXT.md`、`packages/server/src/harness/`）按 **一条 SessionRef、一个 Pi runtime、一份 transcript** 建模。仓库里搜不到 workflow 这个产品对象。既有的 Claude Code 研究（`docs/research/2026-07-16-claude-code-history-messageid.md`）处理的是 **turn 级 messageId**，不是后台 run。

如果 pie 只继续包 Pi，这篇调研的直接动作是：不要在 pie 里发明第四套「skill / hook / command」词汇。外面已经收敛成 Agent Skills + hooks + 脚本编排。Pi 侧如果以后要有可复用流程，优先 skill，不要先做 `.rhai` / `.js` runtime。

如果 pie 要接 Claude Code 或 Grok Build 当 harness（设计文档里已经出现过 `claude-code` adapter），workflow 会撞上几条现有不变量：

1. **Run 不是 turn。** 主会话在 workflow 跑的时候仍然能说话。进度是 phase / agent / token，不是 assistant message。不能把这些折进现在的 `session.turn.ended` 边界。
2. **事件面要多一个对象。** 至少要有 `workflow.started|progress|paused|resumed|stopped|finished`，payload 带 run id、phase、agent 计数、token。订阅模型今天是按 SessionRef。workflow 挂在 session 下还是并列，要单独定。
3. **许可面是第二次提示。** Claude 把「启不启动这场 fan-out」和「子 agent 能不能改文件」分开。pie 现在的 agent-request 通道是为工具调用准备的。一场 50 agent 的 run 如果每个 shell 都冒泡，UI 会不可用。
4. **历史冷读。** Claude 已经有 `getSubagentMessages` / `listSubagents`。workflow 的脚本写在 `~/.claude/projects/` 下的 session 目录。pie 的 getMessages 路径（wayfinder ticket 10）还没走到这一层。
5. **配置发现。** Grok 已经扫 `.claude/` 和 `.cursor/`。pie 如果做 skill 安装（harness 设计里的 `skill` 模块标了暂不细化），发现路径要按「多 harness 共读同一份仓库约定」来设计，不要为每个 adapter 各做一套。

不建议现在实现 workflow runtime。建议先把词汇表写进 `CONTEXT.md` 的避免列表：pie 自己的词继续用 session / turn / worktree；提到 Claude / Grok 时把 workflow 特指「脚本编排的后台 run」，不要用来形容 skill 或日常开发流程。

## 没核实的部分

- 没在本机跑过 `claude` 或 `grok`，所有行为以文档为准。
- Grok 没有独立 workflows 文档页。并发、journal、嵌套禁止、每会话 4 个活跃 run，来自二次分析和源码快照，不是 `docs.x.ai` 的规范承诺。
- 没在本机打开过 `/workflows` dashboard，UI 细节以文档截图和命令表为准。
- 没核对 Agent SDK 里 Workflow tool 的完整 TypeScript 类型；Claude 文档指向 [Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript)。
- 没查 GitHub issues / 团队聊天 / 产品分析。这是公开文档调研，不是 pie 内部决策考古。
- 没比较 OpenAI Codex 的对等层。Codex 在 pie 里是另一条 harness，不在这次范围。

## 来源

- Claude Code workflows: https://code.claude.com/docs/en/workflows
- Claude Code parallel agents: https://code.claude.com/docs/en/agents
- Claude Code features overview: https://code.claude.com/docs/en/features-overview
- Claude Code agent teams: https://code.claude.com/docs/en/agent-teams
- Claude Code scheduled tasks: https://code.claude.com/docs/en/scheduled-tasks
- Claude Code routines: https://code.claude.com/docs/en/routines
- Claude Code docs index（changelog 条目，2026-w22 引入 dynamic workflows）: https://code.claude.com/docs/llms.txt
- Grok Build overview: https://docs.x.ai/build/overview
- Grok Build modes and commands: https://docs.x.ai/build/modes-and-commands
- Grok Build skills / plugins / marketplaces: https://docs.x.ai/build/features/skills-plugins-marketplaces
- Grok Build subagents: https://docs.x.ai/build/features/subagents
- Grok Build worktrees: https://docs.x.ai/build/features/worktrees
- Grok Build background tasks: https://docs.x.ai/build/features/background-tasks
- Grok Build settings: https://docs.x.ai/build/settings/reference
- Grok Build product page: https://x.ai/cli
- Grok Build 发布: https://x.ai/news/grok-build-cli
- Grok Build workflows 发布: https://x.ai/news/workflows
- Grok docs index（Grok Bot 2026-08 条目）: https://docs.x.ai/llms.txt
- 二次分析（Grok runtime 数字，非官方）: https://rohitai.com/blog/xai-grok-build-workflows-parallel-agents
