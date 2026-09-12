# Resource monitoring：独立采样，分别落盘

- 状态：优化提案，待确认，尚未实现；本次不启动采集器、不创建用户日志。
- 背景：[上游调研](../research/2026-09-12-desktop-resource-monitoring.md)。本文维护行为规范，取代早期 daemon-first 和 sidecar 集中写入建议；模块、接口与启动接线见[代码架构方案](resource-monitoring-code-architecture.md)。
- 写入审批：[host persistence inventory](../architecture/host-persistence.md) 保持 proposed；“优化方案”不等于批准第 12 节全部 host writes。

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
- `app.getAppMetrics()` 不是 renderer heap；Pi 使用 Bun，daemon 也可运行于 Bun，不能一律称 V8。字段不可用不写零；不强制补 macOS footprint/Linux PSS，也不在 daemon/Electron 加 native addon。

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

三来源共 **192 MiB JSONL**；锁元数据、文件系统开销和原业务日志不计入，不是整个 logs 或磁盘配额。七天是最大年龄，不保证保存完整七天；容量先满会提前淘汰。不压缩，不建指标数据库或索引。

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

**控制链路**：Electron 根登记是待新增的 Main→本地 server 认证能力，由 Desktop composition root 组装，不经 renderer、不加裸 IPC。当前 PiTransport 内部持有 child 却未公开身份；在真实 spawn/退出边界增加内部观察口，观察失败不能影响 Pi，也不改变 Pi 的对外 RPC。认证不等于已验证目标进程身份。

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

T3 提供 Rust 独立观察、身份和故障隔离参考，但其有界内存历史不是 Pie 的持久化日志。Superset 提供批量进程发现与 Electron 类型映射参考，不照搬指标混用或主线程扫描。OpenCode beta 提醒区分 renderer 深度诊断和日常进程指标。来源证据只维护在[调研文档](../research/2026-09-12-desktop-resource-monitoring.md)，不在这里复制上游实现细节。

## 11. 实施切片与验收

审批后按顺序用 `gh stack`，一关注点一 PR；复杂切片按下面明确的子步继续拆分，不把所有功能塞进一个 PR。当前只有文档变更。

| 顺序 | 切片及子步                         | 完成条件                                                                                                                 |
| ---- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1    | 合同；锁/运行时兼容验证            | JSONL/控制黄金样本、单位/身份/完整性；实际验证 Node/Bun/Electron 和 Rust 锁、崩溃释放/权限；不可行先改提案，不静默换后端 |
| 2    | TS 文件 writer；Rust 文件 writer   | 同一组整轮滚动/保留/故障向量分别通过，数据不跨来源；未接业务采样                                                         |
| 3    | OS 扫描与控制；二进制分发          | 真进程树、背压和 EOF；开发/CLI/Desktop 产物按已支持 OS/架构可启动                                                        |
| 4    | Pi spawn/退出观察；daemon 接入     | 真实身份登记/重放、独立监督、daemon 自报；CLI/前台路径验证                                                               |
| 5    | Electron adapter；composition 接入 | main 自报与根登记，重连/退出正确，不给 renderer/preload 扩权；打包后验证                                                 |

Rust 放 `native/resource-monitor/`，不放 tools/verify；server 的 writer/采样/监督在 observability 邻近模块，路径仍归 config/paths.ts。Electron API 留在 main/electron，writer 经 composition root 注入，不从 Electron adapter 导入 server 实现。二进制随对应 CLI/server/Desktop 分发，Desktop 放 extraResources/asar 外并纳入签名；复用 daemon 用其自带匹配产物。缺失/不兼容明确关闭 OS 来源，不回退到 daemon 内 OS 扫描，不让用户现场编译或下载工具链。

**端到端交付以[代码架构 §7](resource-monitoring-code-architecture.md#7-verify从真实启动到实际落盘)为准**：真实 CLI/Desktop 启动与 Pi 操作、实际进程暂停/恢复、磁盘结果及打包态证据。以下是底层合同检查范围，不要求每条扩展成独立 E2E，也不能用这些检查或模型推演替代真实产品验收。

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

## 12. 实施前待确认的 host-write 决策

第 1 节的默认开启、方向、目录、命名、16/64 MiB 滚动及七天删除已确认，不重新开放讨论。其余 host-write 合同沿用下列具体提案，不为代码架构继续扩展边界情况：

1. 5 秒采样、1 小时滚动、256 文件及 60 秒维护/磁盘恢复；非运行期间不承诺准点清理。
2. 每来源独占锁、Rust 文件锁/TS worker 内 SQLite rollback-journal 后端及附属文件；同 home 非 owner 不自报，不偷锁。
3. 整轮不跨文件、最多一轮在途/1 MiB、忙时跳过而非排历史队列；超限显式 partial；64 KiB 行与控制限制、4,096 目标上限。
4. 0700/0600 与 Windows ACL、白名单/身份/版本/完整性合同、坏保留 header 保守淘汰、关闭/卸载不另行清空历史。
5. 5 秒握手与收尾、1/2/4 秒有限重启、采集进度正常 60 秒复位；磁盘恢复与进程重启分开，不承诺跨重启零空隙。

这些提案确认前，不把锁、worker、日志和清理行为当成已批准或已上线；启用实际 host writes 的切片必须同步更新 inventory。
