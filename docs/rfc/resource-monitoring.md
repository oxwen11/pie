# Resource monitoring：独立采样，分别落盘

- 状态：交付合同保留，待核对验收与写入审批。代码已存在于 `packages/server/src/observability/resources/`、`native/resource-monitor/` 和 Desktop Main；旧稿的“尚未实现”不再代表现状。本次文档清理不运行采集器、不声称完成端到端验收。
- 本文统一保留已确认约束、实现差异和验收要求；不再维护独立调研或旧文件规划。上游来源见第 10 节，现有接线和验收见第 11 节。
- 写入审批：[host persistence inventory](../host-persistence.md) 仍待对齐实际实现和证据；代码存在不等于第 12 节全部 host writes 已通过审批。

## 当前实现与待对齐项

- [config.ts](../../packages/server/src/observability/resources/config.ts) 已实现默认开启、5 秒采样、16/64 MiB、七天保留等配置值；常量存在不证明完整写入合同已兑现。
- [monitor.ts](../../packages/server/src/observability/resources/monitor.ts) 当前按固定 1 秒延迟重启，没有三次预算，也没有第 8 节要求的握手超时；停止等待为 2 秒。有限恢复要求仍待实现或显式修订，不能标为已完成。
- [resources.ts](../../tools/verify/src/resources.ts) 已有 `live/stall/restart/storage/disabled` 验证入口，但 `live` 目前只要求两个完整轮次，且不会驱动真实 Pi 操作。工具返回成功不等于第 11 节全部验收通过。
- 锁后端、权限/路径保护、完整性、打包和开销仍须逐项对照下文合同及证据核实；这不是已完成的安全审计。

## 1. 决策与范围

**已确认约束**：默认开启，显式配置可关闭；独立 sidecar；OS、daemon、Electron 各自采集并写入 `os/daemon/electron`；日期命名 `.jsonl`，无 PID 文件名、无 runId 目录；单文件 16 MiB、每来源 64 MiB；淘汰最旧已关闭文件后继续写；最多保留 7 天，过期删除；普通业务日志不变。

**本轮优化**：一轮采样作为一次写入提交，不跨文件；最多一轮在途，不排历史队列；共享文件 writer 的规则而非集中转发数据；故障恢复归属明确。保留身份校验、完整性标记、权限与并发保护，不用删掉安全约束换取短文档。

首版包含三类采样、滚动文件、有限恢复、诊断状态及离线可读格式。不做图表、历史 API、导出 UI、远程遥测、Heap Snapshot、renderer/Pi profiler 注入、杀进程功能、自适应采样或系统服务。下文未标已确认的数值与机制均为提案。

## 2. 所有权和数据流

| 模块                      | 采集与控制                                                                             | 唯一资源输出          |
| ------------------------- | -------------------------------------------------------------------------------------- | --------------------- |
| Sidecar：Rust + `sysinfo` | OS 进程身份、父子关系、RSS、CPU、自身与采集状态                                        | `resources/os/`       |
| Daemon/前台 server        | 自身 runtime 内存、event-loop delay；登记 daemon、Pi、已连接 Electron 根；监督 sidecar | `resources/daemon/`   |
| Electron main             | main 自身 runtime 内存、`app.getAppMetrics()`；提供根身份/类型映射                     | `resources/electron/` |
| Renderer / Pi RPC child   | 首版无新增采样、自报或资源写入职责                                                     | 无                    |

```text
Electron main ── 自身采样 ──> electron writer ──> electron/*.jsonl
      └─ 本地根身份/类型 ──> daemon
                              ├─ 自身采样 ──> daemon writer ──> daemon/*.jsonl
                              └─ 根集合/配置/停止 ──> sidecar
                                                       └─ OS 采样 ──> os/*.jsonl
```

运行时数值不转发给 sidecar。三个 writer 独立，没有跨来源文件队列、总额度锁或历史服务；首版只关联同机、同用户、同 PID namespace 的进程，不把本地 PID 发给 SSH/远程 server。

**模块划分只有三个职责**：采样模块产出白名单数值；文件 writer 封装锁、编码、滚动、清理和磁盘恢复；sidecar 监督模块维护根集合与子进程生命周期。TS writer 由 daemon/Electron 复用，Rust 按同一合同实现，不引入跨语言日志服务、插件注册表或通用存储框架。

文件 writer 的调用面仅为：带已解析路径和 source 打开、`offer(sample)` 非阻塞接收一轮、读取当前状态、按截止时间关闭。调用方不操作文件、不计算额度、不实现磁盘重试。接收成功只代表交付 writer，不等于已持久化；状态区分最后采样时间与最后完成写入时间。路径/平台依赖在 composition root 注入，不在 writer 内封装另一套平台或 home 解析。

## 3. 开关、路径和作用域

**已确认默认开启**：未设置 `PIE_RESOURCE_LOGGING` 或值为 `1` 时启用，`0` 时关闭；其他值警告后关闭诊断，不影响业务启动。不加持久化配置、UI 开关或输出路径 override。CLI 的 `serve`、detached daemon 和 Electron main 使用同一解析函数，在各自启动入口生效，不因导入模块而启动监控。

- `packages/server/src/config/paths.ts` / `Paths.logsDir` 是唯一根来源；测试用临时 `PIE_HOME`。Sidecar 只接收已解析绝对目录，Electron 不写 userData 或项目目录。
- 同一 home 下前台 `serve` 和 detached daemon 都用 `daemon/`；server 保持 daemon-unaware，不猜启动模式。
- 配置在进程启动时生效；Desktop 复用旧 daemon 不更改其开关。Electron 与 daemon 是否开启分别报告，Electron 自报不等待 daemon 健康或 renderer 加载。

```text
$PIE_HOME/logs/
├── pie.log                         # 原样保留
├── daemon-stdio.log                # 原样保留
└── resources/
    ├── os/
    │   ├── .writer.lock
    │   └── 2026-09-12T10-30-00.000Z.jsonl
    ├── daemon/
    │   ├── .writer.lock
    │   └── 2026-09-12T10-30-00.000Z.jsonl
    └── electron/
        ├── .writer.lock
        └── 2026-09-12T10-30-00.000Z.jsonl
```

文件名是实际 UTC 创建时间，毫秒精度，冒号替换为 `-`。Exclusive-create，碰撞加 `-1`、`-2` 后缀；永不覆盖，重启不追加旧文件。锁及可能的 journal 是控制元数据，不是资源记录（第 7 节）。

## 4. 指标与身份

| 来源     | 首版指标与口径                                                                            |
| -------- | ----------------------------------------------------------------------------------------- |
| OS       | 目标 PID、PPID、启动身份及其来源/精度、类别、RSS bytes；可用 CPU 单核百分比与实际窗口时长 |
| Daemon   | `process.memoryUsage()` 可用字段、runtime 名称/版本、event-loop delay 本窗口 p50/p99/max  |
| Electron | main 自身 memoryUsage；各 Electron 进程的 `app.getAppMetrics()` 数值和类型                |

- OS 枚举可以看到全机进程，但只保存登记根和可验证后代。进程去重后归类，根优先于后代；不能把 daemon 子树与其内 Pi 子树再次相加。脱离父进程的已验证后代每轮复核身份，消失后记录一次并移除，不保留无限 tombstone。
- PID 不是身份。登记只有 PID 时是候选，必须结合原 spawn/根的存活与启动信息验证；已退出、延迟到达或不能证明归属的 PID 不绑定为原 Pi/Electron。启动标识大整数使用字符串；秒级精度不能区分同秒重用，跨来源精度不兼容时不强行 join。父子关系与内存读取不是原子快照，竞态和不确定性显式标 partial。
- 内存统一 bytes、时长统一毫秒；Electron working-set KB × 1024，loop histogram 纳秒 ÷ 1,000,000。CPU 100% 表示一个逻辑核，多线程可超过 100%；记录实际采样窗口，不混用整机百分比或进程生命周期均值。首次/睡眠恢复的 CPU 标 warming-up，loop histogram 每轮读取后 reset；无有效观测标 unavailable，拒绝 NaN/Infinity。
- RSS、working set、physical footprint 不互换；RSS 总和不是共享页去重后的实际物理占用。heapUsed 不加到 RSS，arrayBuffers 不重复加到 external；Electron 数值是补充视图，不再次计入 OS 总量。
- `app.getAppMetrics()` 不是 renderer heap；Pi 使用 Bun，当前 daemon 使用 Node，runtime 名称/版本应按实际进程记录，不能一律称 V8。字段不可用不写零；不强制补 macOS footprint/Linux PSS，也不在 daemon/Electron 加 native addon。

每轮只做一次 OS 批量发现，内存中建父子索引、复用本轮结果分类；不逐目标启动 shell。Electron 的类型映射复用同一次 `getAppMetrics()` 结果，不另开轮询改变 CPU 计量窗口。进程跟踪表上限 4,096，超限报告 partial；`sysinfo` 全机缓存的实际 RSS 另行测量，不把目标/编码上限当成整个进程内存上限。

## 5. JSONL 记录合同

每行一个完整 UTF-8 JSON 对象并以换行结束；单行最多 64 KiB，含换行。每个文件首条为 `file_start`，正常关闭进程可写 `writer_stop`；滚动不冒充进程重启。

| 字段                                | 合同                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `schemaVersion` / `type` / `source` | 首版 1；类型为 file_start、os_sample、runtime_sample、sample_end、collector_status、writer_stop；来源 os/daemon/electron |
| `writer`                            | PID、可用启动身份、每次进程启动生成的随机 instanceId；滚动不变，不增加 runId 路径                                        |
| `sampledAt` / `writtenAt`           | 实际采样与开始写入时间，UTC；无采样的事件只记 writtenAt                                                                  |
| `process` / `metrics` / `status`    | 被测进程身份、白名单数值、unavailable/partial/warming-up 等；缺失不是零                                                  |
| `sampleSequence` / `rowIndex`       | writer 内采样轮次递增，即使跳过写入也不复用编号；轮内样本行从 0 编号                                                     |

`file_start` 另带创建时间及 `retentionStartAt`。轮次最后写 `sample_end`，包含本轮计划写入的 expectedRows、采集起止时间、已应用根 revision（OS 来源）和覆盖状态。读者按 source + writer.instanceId + sampleSequence 检查行号、数量与结束标记；缺行、重复、结束标记缺失、指标读取失败或覆盖不全都不能给出完整总量。零目标有完整结束标记，整轮丢失没有；“完整”只针对登记且可观察的范围，不保证捕获短命进程。

**写入粒度优化**：一轮编码预算最多 1 MiB（含结束标记、本轮状态记录，并预留可能的新 file_start），始终在一个文件内。编码阶段先预留这些控制记录空间，超出字节/进程上限只保留可容纳的行并标 partial、报告截断；超大单行不入文件。expectedRows 指经过显式限额后的计划行数，不能用数量相符掩盖截断。

最多一轮处于编码、传输或写入中，已编码数据合计最多 1 MiB；不另建待写历史队列，也不把 worker 消息复制算成“免费内存”。writer 忙时在编码前跳过新一轮写入、累计 droppedRounds；OS 身份发现和控制处理仍继续。下一轮成功提交时携带累计丢弃数，仅在写入完成后扣除已记录的部分，不能清零写入期间新增的计数；失败则保留。恢复后写当前数据，不回放陈旧采样。

这不是原子磁盘事务：中途崩溃仍可留下完整前缀或残行。读者报告损坏并保留可读行，没有有效结束标记的轮次保持 partial。所有记录使用白名单，禁止 dump API 对象或写入命令、环境、路径、prompt、会话名、标题、令牌及含用户内容的错误堆栈；SessionRef 关联留在业务层。

## 6. 滚动和保留策略

| 属性                      | 每个来源的规则                              | 状态   |
| ------------------------- | ------------------------------------------- | ------ |
| 单文件 / 来源总量         | 16 MiB / 64 MiB，淘汰最旧已关闭文件后继续写 | 已确认 |
| 最大保留                  | 7 天，过期删除，不归档                      | 已确认 |
| 正常采样 / 单文件打开时长 | 5 秒 / 1 小时                               | 提案   |
| 文件数 / 维护与磁盘重试   | 最多 256 个 JSONL / 60 秒                   | 提案   |
| 单行 / 单轮在途编码       | 64 KiB / 1 MiB，无历史队列                  | 提案   |

三来源共 **192 MiB JSONL**；锁元数据、文件系统开销和原业务日志不计入，不是整个 logs 或磁盘配额。七天是最大年龄，不保证保存完整七天；容量先满会提前淘汰。不压缩，不建指标数据库或索引。首版保持 JSONL；若以后要按时间/PID 查询内存历史，再评估每来源 SQLite，本轮不改合同。

**每轮提交在持锁 writer 内串行执行**：

1. 检查过期、时间回退及已知额度；若当前文件不能容纳整轮、已开一小时或已过期，先关闭。不得把同一轮拆到下个文件。
2. 先删过期文件，再按创建时间从旧到新删已关闭文件，预留整轮字节、可能的新 header 与文件名额；成功预留后才 exclusive-create/追加。活动文件是唯一可回收对象时先关闭再淘汰，不能因此永久停写。
3. 按实际短写偏移推进并更新账本，不逐行 fsync。结果不确定或中途失败就关闭、保留残尾，不向旧文件盲目重放整轮；恢复时复核真实大小，开新文件写新轮。
4. 正常容量滚动不消耗故障重试预算。删除/磁盘错误进入第 7 节暂停态，空间恢复后自动继续。整轮滚动会留下不足一轮大小的文件尾部余量（小于 1 MiB），换取不跨文件拼接和整轮额度预留。

**保留依据**：`retentionStartAt` 取文件创建时间与首轮引用的最早采样时间的较早者；后续轮次时间若更早则先滚动。因此该值不晚于文件内最早数据，达到它 + 7 天即过期，不使用 mtime 续期。清理只读有上限的 header 和文件名，不扫描所有指标；保留 envelope 跨 schemaVersion 不变。已知命名但 header 损坏、时间非法/在未来、或晚于文件名创建时间，保守淘汰，不自动修复。

启动获得锁后先维护，第一轮到来才建文件，不反复滚动空文件。每轮追加前检查已知额度/过期；滚动和每 60 秒复核目录。恢复运行先关闭过期活动文件、清理历史、放弃已过期的未完成轮次，再接受新写入；在途 I/O 未结束不能先删活动文件或释放锁。健康调度下空闲清理最多延迟 60 秒；关闭采集、来源退出、睡眠/关机、I/O 卡住或无法取得锁期间无准点删除保证，下次启用并获得锁时先清理。系统时钟异常可提前淘汰，不承诺跨任意改时钟的精确真实时间保留。

清理仅限本来源的已知命名普通 JSONL，不递归、不跟随链接、不删其他来源。未知普通 JSONL 计入预算但不删；未知目录、链接或异常占用报告后暂停，不递归统计，不声称能约束外部任意写入。

## 7. 写入并发和持久性

保留每来源 `.writer.lock`：锁 owner 同时拥有写入和清理权，进程退出自动释放；不按文件存在/mtime 判断存活，不 unlink 锁，不超时偷锁。仅唯一文件名不能保证并发清理安全和 64 MiB 额度，不能以“简化”为由无锁降级。

具体后端提案：`os/` 用 Rust 平台文件锁；TS 两个来源复用 `packages/server/src/daemon/lock.ts` 的 SQLite `BEGIN IMMEDIATE` 模式，但各用自己的路径，不占用启停用的 `daemon/daemon.lock`。保持 rollback-journal 模式，不启用 WAL；可能的 `.writer.lock-journal` 与锁一样仅存有界控制元数据，不存指标。后端跨版本/runtime 保持互斥，Node/Bun/Electron 的实际支持与崩溃释放是实施前置验证。

每个 TS 来源最多一个文件 worker，负责同步锁调用和文件操作；主线程采自己的 heap，不在采样或业务主线程等待。Rust 的输入、扫描和文件写入独立调度；没有每 PID worker、动态任务池或每次失败重建线程。开启时才创建这些资源，其开销必须计入第 11 节测量。

| Writer 状态 | 行为与恢复                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| 关闭        | 不创建目录、worker 或清理器；启用需重启对应进程                                                       |
| 等待锁      | 不写不清理、不缓存历史；按 5 秒节拍尝试，取得锁后先维护再写                                           |
| 可用        | 最多一轮在途，忙则跳过新写入；正常滚动仍为可用                                                        |
| 故障暂停    | 丢弃未提交历史，原因与计数限频报告；磁盘错误 60 秒冷却后复核并恢复，不能通过重启业务或 sidecar 腾容量 |
| 收尾        | 停止接收新轮，最多 5 秒尽力结束已接收轮次并关闭；不提前释放仍有在途操作的锁                           |

Worker 意外退出只有确认旧 worker 已结束后才可按同一冷却策略重建；不能把慢盘当成死亡并不断新建 worker。永久权限/后端不支持等错误不刷屏，保留明确不可用原因。状态变化及重复错误最多每来源每分钟一条普通日志，包含 reason、droppedRounds、最后采样/写入进度；不是另一套状态历史或 UI API。

同 home 多个 Desktop/前台 server 的非 owner 自报不可用，需要完整自报时隔离 PIE_HOME；仍活着但卡死的 owner 不保证自动接管。额度/锁保证针对合作写入者和本地文件系统，不扩展到网络文件系统。

目录 `0700`、日志/锁/journal `0600`，复用现有权限常量；Windows 验证当前用户 ACL，不能以 chmod 数字替代。解析后的 home 下 logs/resources/来源目录、锁/附属文件及日志拒绝符号链接/reparse-point 重定向，使用受约束的文件打开并核对身份，不仅先 lstat 后盲目 open；既存权限不安全则降级，不擅自修改其他数据。崩溃、断电和磁盘故障不承诺零丢失；5 秒是应用收尾预算，不是不可中断内核 I/O 的硬期限。

## 8. 生命周期、恢复与边界

**控制链路合同**：Electron Main→本地 server 根登记由 Desktop composition root 组装，不经 renderer、不加裸 IPC。现有 `POST /api/resources/electron` 沿用 Host/auth 检查、现有 bearer token、64 KiB 请求上限和共享 Schema；无认证的前台 server 不开放登记。Pi 根登记必须来自真实 spawn/退出边界，观察失败不能影响 Pi，也不改变 Pi 的对外 RPC。登记接收和认证都不等于已验证目标进程身份。

Daemon 向 sidecar 发送配置、完整根集合替换与停止；sidecar 返回 ready、已应用 revision、当前采集/写入状态。逐行 JSON 有版本，单帧最多 64 KiB、全部控制缓冲最多 256 KiB，根/类型登记合计最多 256 条；解析前校验长度、字段、PID、范围和版本。超限拒绝帧并报告 partial，旧已验证集合保留但不能声称覆盖完整。根集合只保留最新待发送版本，原子替换；sidecar ready/重启后重放当前存活集合，Electron 重连 daemon 后重新登记。状态只保留最新值，不积压增删事件或健康历史；stdout/stderr 背压不能卡住 OS 写入，stderr 只发限频白名单错误。

| 事件                                                | Sidecar/各 writer 的行为                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 启动                                                | server 开启诊断时启动一个 sidecar；5 秒握手预算，ready 与取得文件锁分开；失败不阻塞业务，三来源独立采样                   |
| Daemon 卡住但活着                                   | Sidecar 继续采样已验证目标，登记滞后可见；不把缺心跳或健康探针失败当死亡，daemon 自报出现空洞                             |
| Daemon 停止、owner 身份消失、控制 EOF/断开          | 进入最多 5 秒收尾；可尝试最终样本，但仅在扫描/写入空闲且剩余预算允许时执行，不排在卡住的旧轮后面；断连不伪造 OOM/崩溃     |
| 正常 daemon 重启                                    | 旧 sidecar 收尾，必要时终止仍持有的 child；新 daemon 启动新 sidecar 并重新登记，不重连旧 sidecar，不承诺零空隙            |
| Sidecar 未经请求退出（包括 exitCode = 0）或握手超时 | 确认旧 child 退出后按 1/2/4 秒最多重启 3 次；连续采集进度正常 60 秒才复位预算，耗尽后等显式服务重启；协议不兼容不循环重试 |
| Sidecar 仍活着但扫描卡住                            | 暴露采集进度空洞，不报告 healthy，不每周期再起线程；首版不承诺治愈无法取消的 OS 调用                                      |
| Electron 退出 / renderer reload                     | 前者只收尾 Electron writer，不停止 detached daemon/sidecar；后者不重启采集，类型映射按新进程更新                          |

控制写端只归 daemon，不泄漏给 Pi/工具后代；sidecar 每轮独立复核 owner 的 OS 身份，owner 消失时仍可用之前已验证目标有限收尾。退出/超时只能作用于已验证、仍拥有的 child，不凭裸 PID 猜测清理。

不保证捕获瞬时峰值、短命进程、系统睡眠期间采样，或全进程组被杀后还能收尾；进程消失不能证明 OOM。各来源失败不重启业务，原业务日志和系统报告仍是原因诊断依据。

## 9. 格式演进、旧数据与卸载

- 这是追加式诊断文件，不用业务 JSON store 的整文件 temp+rename。不迁移/改写现有 `.log`、Pi transcript 或早期手工文件。
- 同版本只加可选字段，不兼容指标结构升级 schemaVersion；文件名、保留 envelope 与锁语义保持兼容。回滚开新文件，不追加新版本文件；读者跳过不支持版本并报告，不当成零值。
- 损坏数据不修复/覆写；有效 header 正常过期，坏 header 按第 6 节淘汰。未知文件不自动删除。
- 关闭采集不另行清空历史，也不运行清理器；再次启用先维护。不增加卸载清理服务，用户明确删除资源目录前应停止对应 writer，不碰其他 Pie 数据。

## 10. 与上游实现的关系

- [T3 Code，57aee3e](https://github.com/pingdotgg/t3code/blob/57aee3e19f1910f3323f06384bb2a1d02b79e369/docs/internals/resource-telemetry.md)：Rust 独立观察、身份和故障隔离；其有界内存历史不是 Pie 的持久化日志。
- [Superset，ea15c21](https://github.com/superset-sh/superset/tree/ea15c2189c89873b842bd144523567a21c2a48e3/apps/desktop/src/main/lib/resource-metrics)：批量发现与 Electron 类型映射；不照搬指标混用或主线程扫描。其[移除高频遥测的案例](https://github.com/superset-sh/superset/pull/5964)支持本地有界采样，而非逐轮远程上报。
- [OpenCode beta，0f26ad8](https://github.com/anomalyco/opencode/tree/0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5/packages/desktop/src/main)：当时未提供同类生产进程树监控；renderer 深度诊断不等于日常进程指标。

Sidecar 的价值是 daemon 卡住时仍能观察，不是取得 OS 原本不可见的 heap；保留证据还需要独立写盘与收尾合同。

## 11. 现有接线与剩余验收

### 接线和分发边界

现有 server 入口是 [http/serve.ts](../../packages/server/src/http/serve.ts)，进程级服务在 [service.ts](../../packages/server/src/observability/resources/service.ts)，Desktop 接入在 [resource-monitoring-live.ts](../../apps/desktop/src/main/resources/resource-monitoring-live.ts)。JSONL/控制 Schema 在 [resource-monitoring.ts](../../packages/contract/src/resource-monitoring.ts)，Rust 在 [native/resource-monitor/](../../native/resource-monitor/)。沿这些入口补齐差异，不照旧文件规划重复创建模块。

需保持的边界：server 只创建一个进程级实例并传给 RPC；Pi 登记使用 child 生命周期，不扫描 transcript；Electron 自报不等 daemon/renderer，登记随本地连接重建。TS 两来源复用 writer 代码，不共享实例；Electron 不启动第二个 sidecar。关闭监控和内部测试使用显式 discard。主进程采自己的 heap，文件 worker 不冒充 main 采样。

路径仍归 config/paths.ts。Electron API 留在 main/electron，writer 经 composition root 注入；不开新端口、token 文件或 renderer 权限，不另建 ManagedRuntime。启动新 daemon 时沿现有完整 login-shell 环境传递开关，复用旧 daemon 不修改其配置。

文件 worker/native executable 必须随 CLI/server/Desktop 分发，不能运行时依赖 TS 源码、cwd 或下载/编译工具链。Desktop 产物在 asar 外并纳入签名；复用 daemon 用它自带的匹配产物。缺失/不兼容时明确报告来源不可用，不回退到 daemon 内 OS 扫描。

### 真实产品路径

沿 [CLI recipe](../../.agents/skills/verify-pie-cli/SKILL.md)、[Desktop recipe](../../.agents/skills/verify-pie-desktop/SKILL.md) 的 Launch → Doctor → Drive → Evidence → Cleanup，复用 `pnpm exec pie-verify cli|desktop resources <case>`。现有驱动不完整覆盖以下合同，缺项须补齐或单独记录证据，不以 case 名或成功退出替代验收。

- 每组开关使用全新隔离 run；先清理自己上一轮的 run，不用 `--replace` 接管未知进程。默认开启用 `env -u PIE_RESOURCE_LOGGING`，显式 `1` 另做 CLI 短验证；关闭用 `0`。CLI 分别验证 detached daemon 和前台 `serve`。
- 操作前核对 current run、隔离 home、进程身份和归属。Daemon 从本轮 `daemon.pid` 读取，前台 serve 用 verify 记录；Electron main 不能用开发 launcher PID 代替。暂停/终止只针对仍匹配的本轮进程。
- 用真实 Pi、真实采集器和文件 writer，不直接登记测试 PID，不使用 fake-pi、`PIE_E2E=1` 或手写新样本冒充产品结果。缺模型/权限时标 blocked。
- 按生产 5 秒节拍，ready 后最多 30 秒等至少三个完整轮次；每个动作有超时。配额压力单独记录耗时，不调生产默认值。

| Case       | 必须取得的证据                                                                                                                                                                                                                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live`     | CLI 有 os/daemon、无 Electron 来源；Desktop 三来源均至少三个完整轮次。实际导入项目、新建会话，让 Pi 启动至少存活 30 秒的轻量子进程并输出随机标记；UI 回复和命令输出包含标记。独立 OS 清单与采样匹配 daemon、Pi、工具后代、Electron main/renderer 及实际存在的 GPU/utility；退出目标不再标存活。保存动作时间、身份与原始样本，不能只看目录存在。          |
| `stall`    | Desktop 稳定采样后，单独暂停 daemon 至少 15 秒，不暂停进程组。先安排独立超时恢复，finally 也恢复。暂停期间 health 超时、daemon 自报空洞；**恢复前读盘**已有至少两轮采样时间位于暂停区间的完整 OS 样本，Electron 自报继续，sidecar 身份不变；恢复后 health/自报恢复。不支持真实暂停的平台标未验证，不把整进程暂停称为仅阻塞 JS loop。                     |
| `restart`  | 保持真实 Pi 存活，终止本轮 sidecar，证明新 sidecar 不重启 daemon、不新建会话就采到原 Pi。退出 Electron 后其自报停止、os/daemon 继续；同一隔离 home 重开后恢复新 Electron 身份和三来源。每个重启 writer 开新文件，未过期旧文件内容不变，同一 daemon 只有一个 sidecar。                                                                                    |
| `storage`  | 先停本轮产品并确认 writer 退出，在隔离 home 预置标记过的合法关闭文件：每来源 64 MiB（含 header/换行），另加 retention 已过七天而 mtime 当前的文件。重启真实 Desktop；证明过期删除、最旧淘汰、每来源 ≤64 MiB/单文件 ≤16 MiB，随后仍有三个当前完整轮次和正常业务。保存各阶段清单/字节数；不改时钟/活动文件，夹具不算采样证据，也不声称自然增长轮转已验证。 |
| `disabled` | 全新 home 关闭监控，覆盖 daemon/serve/Desktop；Desktop 重走真实会话并观察至少 30 秒。无 sidecar、资源 worker、锁或 resources 目录，业务日志/会话正常。对已有历史另做关闭启动，文件清单和内容摘要不变。用本轮 runtime/线程观察检查 worker，不能只凭无文件断言无采集，也不新增产品测试接口。                                                               |

`live` 还须核对可用 runtime 指标有数值；稳定目标 RSS 与相近时刻、同口径独立 OS 观测对照，排除恒零和 1024 倍单位错误，不要求完全相等或拿 footprint 比 RSS。独立进程证据仅保留 PID、PPID、出生身份、类别及必要数值，不采集命令行或环境。

### 文件边界与开销

真实 TS/Rust writer 使用同一组合法整轮数据、正式 16/64 MiB 配额、临时目录和真实磁盘，累计写过 64 MiB，证明整轮滚动、淘汰后续写及保留文件可读。不 mock fs，不自写一套滚动算法来验证自身，也不为触界制造数千进程或加生产加速开关。这是 writer 集成检查，不替代产品路径。

产品日志共用只读检查器，验证来源、实例、轮次、唯一 rowIndex、结束标记/行数、实际字节数和不跨文件。复用 Schema，不复用 writer 的淘汰逻辑计算期望值；健康路径不能用 partial 冒充成功。活动文件只判断完整落盘轮次，停止后再查残尾。

**验收矩阵**（不是已验证功能）：

| 目标           | 必须出现的结果                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 独立性         | 真实 daemon 至少 15 秒无法推进（可暂停整进程），恢复前 OS 文件已新增样本；daemon 自报空洞，Electron 不受牵连                                     |
| 整轮写入       | 文件剩余空间小于下一轮时先滚动；一轮不跨文件；忙时整轮跳过，内存不长队列；截断标 partial，结束标记缺失/重复行不能给完整总量                      |
| 滚动与恢复     | 连续超过 16/64 MiB、256 文件仍删旧续写；计入 header/换行/状态行；删除失败暂停，恢复无需重启；短写不重复、残尾不拼新行                            |
| 七天上限       | mtime 仍新、积压/慢 I/O、时钟回退、睡眠后的活动文件、坏 header/新版 envelope 都不能给旧样本续期                                                  |
| 并发与安全     | 同名创建/两实例竞争/owner 崩溃互斥；锁不偷取；符号链接/reparse point、未知文件与错误权限不伤其他数据，无敏感字段                                 |
| 登记与生命周期 | PID 重用/登记前退出不误认；sidecar 独立重启后存活 Pi 仍被登记；Electron 重连恢复；握手超时/管道阻塞/EOF/零码退出/重试耗尽均有界，不泄漏进程/线程 |
| 数值与平台     | 字节/时长/CPU窗口正确，首次/睡眠不伪造零；Bun/Node/Electron 缺字段可见；逐已支持平台验证打包、执行权限、签名与降级                               |

开销验证先用固定 5 秒节拍，不提前加入自适应策略。相同工作负载分别关闭/开启监控，至少覆盖空闲、多个 Pi 活跃和大量后代；记录主线程 CPU/loop delay、请求 p95 延迟、各进程与文件 worker 合计 RSS、sidecar 扫描时长、写入量及 droppedRounds。健康磁盘的代表性负载不应持续丢轮，单轮处理应赶得上下个节拍；否则先降低采样/编码/写入成本，而不是放大队列。以测量报告决定是否需要进一步优化，不预报未经测量的开销数字。

### 打包态与证据

开发态 `tsx` CLI / `electron-vite dev` 不能证明分发可用。用 turbo 构建后，将 CLI 发布包安装到仓库外临时目录，Desktop 启动真正打包应用；从无关 cwd 启动，不提供源码定位 override 或 Rust 工具链。记录实际 worker/native 路径，必须来自安装产物；验证工具不得偷偷回退开发入口。

每个声称支持的 OS/架构/runtime 组合至少跑打包态 `live` 和 `disabled`，Desktop 另跑 `stall`；不适用明确标出，不用开发机代替。缺 binary、错误架构、权限/签名导致监控降级，即使窗口正常也不算验收通过。

每个 case 报告 commit、产物版本、平台/架构/runtime、启动方式、开关、步骤时间、断言实测值和 passed/failed/blocked。保存原始 JSONL、文件清单/字节数、独立进程观察、health 和必要日志，按 `writer.instanceId + sampleSequence` 关联，不跨实例只比序号。夹具和实际采样证据分开。

Desktop 按[证据规则](../../.agents/rules/verify-evidence.md)保留操作前后截图及全过程短视频，采样仍以磁盘证据为准；CLI 保存日志及 HTTP/磁盘结果。Cleanup 前保存至既有 evidence 目录，不泄露 token，不复制未脱敏 daemon.pid，截图/视频不提交 Git，随 PR 附件交付。失败也恢复暂停进程、停止受控子进程并保存证据；cleanup 后确认本轮 daemon/sidecar/Electron/测试子进程已退出，不能只删目录。

没有真实 Pi、打包态或执行证据就逐项报告缺口，不把文档检查或单测称为端到端通过。后续补齐按合同/存储/接入/分发拆小 PR，用 `gh stack`，每片同步验收，不再恢复旧的整套实施计划。

## 12. 待确认的 host-write 决策

第 1 节的默认开启、方向、目录、命名、16/64 MiB 滚动及七天删除已确认，不重新开放讨论。其余 host-write 合同沿用下列具体提案，不为代码架构继续扩展边界情况：

1. 5 秒采样、1 小时滚动、256 文件及 60 秒维护/磁盘恢复；非运行期间不承诺准点清理。
2. 每来源独占锁、Rust 文件锁/TS worker 内 SQLite rollback-journal 后端及附属文件；同 home 非 owner 不自报，不偷锁。
3. 整轮不跨文件、最多一轮在途/1 MiB、忙时跳过而非排历史队列；超限显式 partial；64 KiB 行与控制限制、4,096 目标上限。
4. 0700/0600 与 Windows ACL、白名单/身份/版本/完整性合同、坏保留 header 保守淘汰、关闭/卸载不另行清空历史。
5. 5 秒握手与收尾、1/2/4 秒有限重启、采集进度正常 60 秒复位；磁盘恢复与进程重启分开，不承诺跨重启零空隙。

这些提案确认前，不把现有锁、worker、日志和清理代码当成已批准、已验收的合同；补齐实现或审批的切片必须同步更新 inventory。
