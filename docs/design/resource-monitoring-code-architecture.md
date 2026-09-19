# Resource monitoring：代码架构方案

状态：代码组织提案，尚未实现。**默认开启已确认**；未设置 `PIE_RESOURCE_LOGGING` 或为 `1` 时开启，`0` 关闭。本文确定模块、接口、启动接线及端到端验收；指标、文件格式、保留与恢复规则统一引用[行为方案](resource-monitoring.md)，不再扩展边界情况。

## 1. 总体结构

不新建日志服务或独立 TS package。使用现有 server observability 模块、一个 Rust executable、一个轻量 Electron adapter。

```text
Server 进程：runServe
  ├─ 现有 Observability                 ──> pie.log（不变）
  └─ ResourceMonitoring（唯一实例）
       ├─ readRuntimeMetrics → writer   ──> resources/daemon/*.jsonl
       ├─ Pi spawn/退出 → 根集合
       ├─ Electron HTTP 登记 → 根集合
       └─ sidecar.ts → Rust 子进程
                        └─ sampler → writer ──> resources/os/*.jsonl

Electron main：desktop-runtime
  ├─ readRuntimeMetrics + Electron adapter
  │    └─ 同一份 TS writer 的独立实例    ──> resources/electron/*.jsonl
  └─ 根身份/类型 → 现有本地 HTTP 连接 → server
```

**复用的是 writer 代码，不是 writer 实例。** Electron 不启动第二个 OS sidecar，也不把内存数值发给 daemon。Pi 和 renderer 不增加采样代码。

## 2. 新增文件与职责

以下路径是计划新增，不是现有实现。

```text
packages/contract/src/
└── resource-monitoring.ts       # JSONL、根登记、sidecar 控制的 Schema/类型

packages/server/src/observability/resources/
├── index.ts                     # ResourceMonitoring、进程级组装、根集合
├── config.ts                    # 开关/固定默认值、分发产物定位
├── runtime-metrics.ts           # 读取本进程 memoryUsage / event-loop delay
├── writer.ts                    # offer/status、编码与单轮准入、worker 句柄
├── writer-worker.ts             # 锁、文件写入、滚动、清理；独立构建入口
└── sidecar.ts                   # Rust spawn、控制协议、监督与登记重放

apps/desktop/src/main/
├── electron/resource-metrics.ts # 只访问 Electron API，返回本轮指标和类型
└── server/resource-registration.ts # 通过现有连接登记根与类型，不读取 Electron

native/resource-monitor/
├── Cargo.toml
└── src/
    ├── main.rs                 # 配置与生命周期、独立采样节拍
    ├── protocol.rs             # 控制消息和 JSONL 数据结构
    ├── sampler.rs              # OS 批量发现、进程归属、资源指标
    └── writer.rs               # Rust 本地 writer，同一文件合同
```

`packages/server/src/config/paths.ts` **原地增加** `resourceSourceDirectory(logsDir, source)`，所有来源目录仍只在这里命名。`resources/config.ts` 不定义第二套 PIE_HOME 或日志路径规则。

新增两个模块导出：`@getpie/contract/resource-monitoring`、`@getpie/server/observability/resources`。合同不挂入 renderer 的业务 router；现有 `observability/index.ts` / `logging.ts` 的业务日志行为不变。

不额外拆 RootsManager、RetentionService、LockService、QueueService；这些是上述模块的内部实现。只有被进程入口、Pi 和 HTTP 同时使用的 `ResourceMonitoring` 采用 Effect Context.Service，其余保留普通函数/有 Scope 的资源句柄。

## 3. 三个关键接口

下面是接口形状，不是完整可编译实现；数据类型在合同切片定义。

### ResourceWriter：只负责本来源文件

```ts
type ResourceWriter = {
  offer: (sample: SampleRound) => boolean;
  status: () => WriterStatus;
};
```

- `openResourceWriter({ directory, source, workerEntry })` 在 Effect Scope 内创建句柄，关闭由 Scope finalizer 负责，调用方不手动管理锁或文件。
- `offer` 立即返回是否接收，不等待磁盘；writer 管理编号、编码、丢弃计数和完成状态。忙时不形成历史队列。
- `writer.ts` 在当前进程执行有界编码并把数据交给 worker；`writer-worker.ts` 只做文件操作，完成后才返回写入确认。
- worker 不调用 `process.memoryUsage()`，避免把 worker heap 记录为 main heap。普通日志使用既有 observability，资源文件独立。
- Rust `writer.rs` 不调用 TS、不通过 daemon 代写；用相同样例验证文件合同即可，不做代码生成框架。

### ResourceMonitoring：server 进程级入口

逻辑接口为 `observePiChild`、`updateElectron`、`status`：

| 接口                           | 作用                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `observePiChild(observation)`  | 接收 transport 的真实 child 观察信息，在 child Scope 内登记；结束时注销，不等待 sidecar |
| `updateElectron(registration)` | 更新对应 Electron main 的根与类型集合，不接收 runtime 内存数值                          |
| `status`                       | 当前启用状态、采集/写入进度；供原业务日志和测试读取，不提供历史 API                     |

`index.ts` 拥有一份当前根集合：daemon 自身、存活 Pi 候选与已连接 Electron 根。根变化后把完整集合交给 `sidecar.ts`。`sidecar.ts` 只保存最近一次控制快照用于发送/重放，不再维护第二份会话目录或查询 session 文件。

`makeResourceMonitoring` 先返回可用句柄，初始化采集器和文件 writer 在 scoped fiber 内执行；服务启动不等待磁盘或 sidecar ready。`ResourceMonitoring.discard` 提供显式无操作实现，供关闭监控和直接构建内部运行时的测试使用。

### 采样 Adapter：只读一次

- `runtime-metrics.ts` 提供有生命周期的 runtime reader：每轮读取当前进程内存和 loop delay，释放时关闭 histogram。
- `electron/resource-metrics.ts` 每轮只调用一次 `app.getAppMetrics()`，返回数值与 PID/type 信息；不导入 server 实现、不管理网络或文件。
- Daemon 和 Electron 的调用方各自每 5 秒组装一个 `SampleRound`，送本地 writer。Electron 根类型映射复用该轮结果，不新增另一条采样定时器。
- OS 的 5 秒定时器在 Rust 内，daemon 不逐轮发“请采样”命令。

## 4. 接入现有代码

### Server 启动

[http/serve.ts](../../packages/server/src/http/serve.ts) 的 `runServe` 是唯一生产启动点：

1. 从当前启动环境解析开关，使用已有 Paths 和 observability。
2. 创建一次 ResourceMonitoring：daemon runtime reader/writer、根集合、sidecar 监督均属于这个进程 Scope。
3. 继续调用 `createServer`；沿已有 `effectContext` 把同一实例传到 RPC/HTTP 运行时。
4. 退出时先停止业务入口及 Pi 运行时，再释放 ResourceMonitoring；监控启动/退出失败不替代业务结果。

[rpc/handlers.ts](../../packages/server/src/rpc/handlers.ts) 保留现有 `provideMerge` 上下文传递方式，并补齐 ResourceMonitoring 的依赖类型。[rpc/runtime.ts](../../packages/server/src/rpc/runtime.ts) **消费实例，不再创建实例**。不要在模块 import、每个 RPC runtime 或每个 Pi session 上重复启动采集器。

### Pi 进程登记

复用真实调用链：

```text
rpc/runtime.ts 的 PiProcessLayer
  → makePiProcess(options)
  → makePiTransport(options)
  → spawn child → 观察口登记 → child 结束 / Scope 关闭时注销
```

只在 [process.ts](../../packages/server/src/harness/pi/process.ts) 传递内部观察回调，在 [transport.ts](../../packages/server/src/harness/pi/transport.ts) 的 spawn/退出处调用。观察口由 transport 定义，ResourceMonitoring 在 composition root 适配它；transport 不反向依赖 observability 的实现。PID 来自 child handle，不扫描 transcript、不扩展 Pi RPC、不改变 session 的业务职责。

### Electron main 接入

[desktop-runtime.ts](../../apps/desktop/src/main/desktop-runtime.ts) 在现有 `app.whenReady()` 后、同一个 ManagedRuntime/Scope 中组装两条独立任务：

1. 本地采样任务：runtime reader + Electron adapter → Electron writer，不等待 server 连接。
2. 登记任务：消费已有 `LocalServer.changes`，ready 后读取 `LocalServer.connection`，使用最新地址/token 发送登记；类型变化时更新，daemon 重连时重发。

`resource-registration.ts` 是 server platform adapter，只接收根数据和连接信息。Electron adapter 通过 composition root 提供的普通回调/返回值与其协作，二者不互相导入。现有 `desktop-runtime-glue.ts` 可承载需要同时访问两边的组装，不再增加另一个 ManagedRuntime。

Main 与 server 各自在入口解析默认开关，启动新 daemon 时显式透传该开关，保留现有完整 login-shell 环境恢复；复用已运行 daemon 不修改其配置。Home 继续使用现有 resolvePieHome/Paths，不让 writer/sidecar 自行推导。Renderer reload 不重建这些任务，Desktop 退出仅释放本进程资源。

### Main → daemon 登记

在现有 [http/app.ts](../../packages/server/src/http/app.ts) 增加一个内部路由：

```text
POST /api/resources/electron
Authorization: Bearer <现有 daemon token>
body: ElectronRegistration（根身份 + PID/type 集合）
```

沿现有 Host/auth 检查，限制并用共享 Schema 校验请求后调用同一 ResourceMonitoring 实例。仅在本地认证模式提供此路由；无认证的前台 server 不开放任意进程登记。回应表示登记已接收，不等同于 OS 身份已验证。没有新端口、新 token 文件或裸 Electron IPC；renderer/preload 和业务 oRPC router 不变。

## 5. 构建与分发

文件 worker 和 Rust executable 都是产品运行产物，不能仅在源码目录下能运行。

- [server/tsdown.config.ts](../../packages/server/tsdown.config.ts) 保留 `server.mjs`，新增独立构建入口，输出 `dist/resources/writer-worker.mjs`；Rust 构建输出同目录的 `resource-monitor`（Windows 为 `.exe`）。worker 自包含，不依赖运行时加载 TS 源码。
- Server 增加 `./resource-writer` 包导出指向该 worker。资源定位器用包导出定位 worker，再取同目录 native binary，不依赖 cwd。
- [pie/tsdown.config.ts](../../packages/pie/tsdown.config.ts) 像复制现有 pi-rpc 产物一样复制整个 `resources/`，CLI 提供对应包导出；发布包同时携带 JS worker 与匹配 native binary。
- [electron-builder.yml](../../apps/desktop/electron-builder.yml) 将 server 的 `dist/resources/**` 解包到真实文件目录并纳入签名。Electron Main 仍复用 server 的同一份 writer 代码与产物，不另外构建一套。资源定位沿用仓库现有包导出/asar-unpacked 约定，不从 observability 导入 harness 的私有函数。
- Desktop、普通 Node daemon、Bun daemon 与 CLI 都通过该定位器取得自身安装的产物。资源开关只管监控启停，不成为额外日志目录配置。

## 6. 实施顺序和完成标准

按小切片组成 `gh stack`，先打通主路径：

1. **合同与路径**：Schema、开关解析、来源路径与样例。
2. **文件 writer**：先 TS，再 Rust；各自实现并验证相同合同。
3. **OS sidecar 与产物**：真进程采样、控制链路、开发/分发定位。
4. **Server/Pi 接入**：runServe 唯一实例、Pi 观察口、内部登记路由。
5. **Electron 接入**：main 自报、登记、重连和打包验证。

每一项内的独立关注点可继续拆 PR，不提前重构无关目录。Server 接入切片同时落地 CLI 验收，Electron 接入切片同时落地 Desktop 验收；不能把 verify 留成最后的人工 TODO。具体操作、通过标准和证据见第 7 节。

直接构建内部运行时的测试显式提供 discard；产品级验证使用临时 PIE_HOME，并分别覆盖默认开启和 `PIE_RESOURCE_LOGGING=0`。文档中的新文件、导出、路由、接口、构建入口与资源验收命令均待实现，本次不新增产品代码，也不声称已经通过运行验收。

## 7. Verify：从真实启动到实际落盘

### 7.1 复用现有入口，不另建测试框架

沿用 [CLI recipe](../../.agents/skills/verify-pie-cli/SKILL.md)、[Desktop recipe](../../.agents/skills/verify-pie-desktop/SKILL.md) 的 **Launch → Doctor → Drive → Evidence → Cleanup**。在 `tools/verify/src/resources.ts` 增加一个资源验收驱动，由现有 `commands.ts` 接入 `resources` 子命令，复用现有运行记录、进程、HTTP、等待与证据工具。不新增测试 package、skill-local 脚本或产品测试 RPC。

驱动只做三件事：操作本次启动的真实进程；读取实际 JSONL 并断言；保存证据。不得直接调用 ResourceMonitoring 登记测试 PID，不替换采样器/writer，不用 fake-pi、`PIE_E2E=1` 或手工写入的新样本冒充采集结果。

下面的 `launch/doctor/evidence/cleanup` 已存在，**`resources <case>` 是待实现入口**：

```bash
# 每组开关验证必须使用新 run；launch 会复用健康实例，不能仅改环境后重跑 launch。
# 先完成并清理自己上一轮的 run，不使用 --replace 接管不明来源进程。
env -u PIE_RESOURCE_LOGGING pnpm exec pie-verify cli launch
pnpm exec pie-verify cli doctor
pnpm exec pie-verify cli evidence init
pnpm exec pie-verify cli resources live
# 保存证据后 cleanup；另一个新 run 用 launch --serve 验证前台入口。
pnpm exec pie-verify cli cleanup

env -u PIE_RESOURCE_LOGGING pnpm exec pie-verify desktop launch
pnpm exec pie-verify desktop doctor
pnpm exec pie-verify desktop evidence init
# 先录屏并发起下面的真实 Pi 操作；受控子进程存活时运行 live。
pnpm exec pie-verify desktop resources live
pnpm exec pie-verify desktop resources stall
pnpm exec pie-verify desktop resources restart
pnpm exec pie-verify desktop resources storage
# 所有证据保存后才 cleanup；Desktop 退出不等于 daemon 停止。
pnpm exec pie-verify desktop cleanup

# 上一轮已清理后，在全新 home 验证关闭；CLI daemon/serve 同样执行。
PIE_RESOURCE_LOGGING=0 pnpm exec pie-verify desktop launch
pnpm exec pie-verify desktop doctor
pnpm exec pie-verify desktop evidence init
pnpm exec pie-verify desktop resources disabled
pnpm exec pie-verify desktop cleanup
```

资源驱动在操作前验证 current run、隔离 home 和进程归属。Daemon 地址/PID 从本次 `daemon.pid` 读取；前台 serve 使用 verify 记录，不能假设它有 daemon.pid。Electron main 的真实 PID 不能拿 electron-vite launcher PID 代替。暂停、终止、重启只作用于本轮拥有且身份仍匹配的进程。

### 7.2 必须跑通的用户路径

正常等待以 5 秒生产节拍为基础：ready 后最多 30 秒等到至少三个完整轮次；每个动作都有超时，超时即失败，不无限等到偶然通过。长时间配额压力另行记录耗时，不修改生产默认值。

| Case                                    | 操作                                                                                                                                                                                                                                                                           | 通过标准与证据                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live`：默认启动与真实进程覆盖          | CLI 分别真实启动 detached daemon、前台 `serve`。Desktop 实际导入 verify 项目、新建会话、发送请求，让真实 Pi 执行一个受控命令：启动一个保持至少 30 秒的轻量子进程，输出随机验收标记后正常结束。验收驱动从 OS 独立记录这条进程链及身份，不向产品登记它。                         | CLI 有 `os/daemon` 当前样本且没有 Electron 来源；Desktop 三来源均至少三个完整轮次。OS 样本匹配实际 daemon、Pi、工具后代、Electron main/renderer，以及本次确实存在的 GPU/utility 进程；不存在的类型不伪造。进程退出后不再作为存活目标采样。Pi 命令输出和 UI 回复包含本轮标记，证明业务链路真的走通。保存动作时间、独立 OS 进程清单和对应原始样本，不能只检查目录/文件存在。 |
| `stall`：daemon 不推进，OS 仍落盘       | 在 Desktop 已登记且稳定采样后，POSIX 对本次 daemon 单独 `SIGSTOP` 至少 15 秒，再 `SIGCONT`；不暂停整个进程组。驱动必须先安排独立的超时恢复，并在 finally 恢复 daemon。其他平台用对应的真实进程暂停/恢复工具；做不到就标该平台未验证。                                          | 暂停区间 health 请求超时；daemon 没有该区间的新自报采样。**在恢复之前**读取磁盘，OS 文件至少有两轮 `sampledAt` 落在暂停区间的完整样本，Electron 自报也继续。Sidecar 身份不变；恢复后 health 和 daemon 自报恢复。保存暂停/恢复时间及恢复前读取的文件证据，不能用恢复后补写的行证明独立性。这是整进程暂停证明，不冒称只阻塞了 JS event loop。                                |
| `restart`：恢复登记与独立退出           | 保持真实 Pi 存活，终止本轮 sidecar，等待 daemon 监督重启；随后正常退出 Electron 而保留 daemon，再用原隔离 home 重新启动 Desktop。操作前后均记录进程身份。                                                                                                                      | 新 sidecar 无需新建会话就重新采到原 Pi；daemon 未被重启。Electron 退出后其自报停止，`os/daemon` 仍有当前样本；重开后恢复三来源，并采到新的 Electron 身份。各 writer 重启开新文件，已经关闭且未过期的旧文件内容不变；同一 daemon 只有一个 sidecar。保存各阶段文件清单、完整轮次及进程清单。                                                                                 |
| `storage`：满额删旧，七天删除，继续采集 | 驱动先停止本轮产品进程但保留隔离 home，确认 writer 已退出。仅在该 home 预置明确标记的历史夹具：每来源总字节数达到 64 MiB（含 header/换行）的合法未过期关闭文件，及一份 retention header 已超过七天、mtime 却为当前时间的文件。重启真实 Desktop；不改系统时钟、不编辑活动文件。 | 启动维护及真实新样本写入触发过期删除和按需最旧文件淘汰；每来源 JSONL 总量 ≤64 MiB、单文件 ≤16 MiB。淘汰后仍写入至少三个当前完整轮次，没有因满额关闭监控；其余保留文件可读且内容不变。记录准备清单、每阶段字节数/删除文件、新采样原文及 business health。夹具只作为已有磁盘压力，不计入采样证据；本项不冒称已跑过自然增长至 16 MiB 的单文件轮转。                           |
| `disabled`：关闭不影响使用              | 全新 home、`PIE_RESOURCE_LOGGING=0` 分别启动 CLI daemon、serve、Desktop。Desktop 重走一次真实会话请求，至少观察 30 秒。另对有历史的本轮 home 停止再关闭监控启动，记录启动前后历史摘要。                                                                                        | 业务 health/会话正常；没有 sidecar、资源文件 worker 或资源锁，干净 home 不产生 `logs/resources/`。已有历史内容、文件清单不变，没有顺手清理；原业务 `.log` 正常使用。保存进程/worker 观察、文件清单和业务结果；“没有文件”本身不能证明没有偷偷采集。Worker 的存在性通过本轮运行时调试/线程观察核对，不为验收新增产品接口。                                                   |

`live` 还需核对数值：runtime heap/RSS 等可用字段确有数值；选取稳定存活的目标，将 OS 日志的 RSS 与独立、同口径、相近时刻的 OS 观测比较，至少排除恒零及 KB/bytes 相差 1024 倍的错误。不要求不同时间读数完全相等，也不拿 footprint 和 RSS 互比。独立进程清单只保存 PID、父 PID、出生身份、类型和必要数值，不采集命令行或环境变量。

默认开启必须真的删除启动环境中的变量，不能只测 `1`。显式 `1` 再做一次 CLI 启动/落盘短验证即可，不把相同完整流程复制三遍。真实 Pi 缺少可用模型或权限时，将该路径标为 blocked，不用假进程替代后宣布通过。

### 7.3 只补必要的文件边界检查，不拿它冒充端到端

每五秒采样的低流量来源可能数小时都填不满一个文件，且一小时滚动还可能先发生。不要为触界在 Desktop 制造几千个进程，也不要增加生产“加速采样”开关。

只留一个有实际价值的补充磁盘检查：对真实 TS writer 和 Rust writer 喂同一组合法整轮数据，使用正式 **16 MiB / 64 MiB** 配额，累计写入超过 64 MiB；检查不足下一轮时换文件、一轮不跨文件、淘汰后继续写入、保留文件均可读。使用真正 worker/native 文件实现、临时目录和真实磁盘，不 mock fs，也不重新实现一套滚动算法来证明自己。这是 writer 集成检查，单独报告，不能替代上表的产品端到端验收。

所有产品日志检查共用一个只读检查器：逐行解析；检查来源、实例、轮次、唯一 rowIndex 和结束标记/行数；按文件统计字节并检查同轮没有跨文件。健康路径必须有完整轮次，不能把一串 partial 当成功。读取活动文件只判断已落盘的完整轮次；最终停止后再检查残尾。复用共享 Schema，但不调用 writer 的额度/淘汰实现算期望值。不再加模拟 20,000 次滚动、100,000 次 tick 或逐内部函数的重复测试来充数。

### 7.4 打包态是独立交付门槛

当前 CLI launch 运行 `tsx` 源码，Desktop launch 运行 `electron-vite dev`，**两者通过都不能证明分发可用**。验收工具需支持指定本地构建产物启动，沿用同一隔离、doctor、检查器和 cleanup；不能偷偷回退开发入口。

通过 turbo 构建对应产品后，将实际 CLI 发布包安装到仓库外的临时目录，运行安装后的 `pie`；Desktop 运行真正打包的应用，不是 `out/main` 或开发壳。从无关 cwd 启动，运行环境不提供源码定位覆盖或 Rust 工具链。记录实际 worker/native 加载路径，必须来自安装产物，不能落回本仓库 `dist`。

每个声称支持的 OS/架构及 Node/Bun/Electron 组合都至少跑打包态 `live` 和 `disabled`；目标平台不支持某运行时时明确列为不适用，不用开发机结果代替。Desktop 再跑 `stall`，证明实际打包的独立 sidecar 在 daemon 暂停时仍能写。缺 binary、错误架构、权限或签名导致监控降级，即使业务窗口正常也不能算默认监控验收通过。

### 7.5 证据与完成判定

每个 case 写入同一份验收报告：commit、产物版本、平台/架构/runtime、启动方式、开关状态、步骤时间、断言实测值，以及 `passed / failed / blocked`。保存原始 JSONL 片段、文件清单/字节数、独立进程观察、必要业务日志和 health 结果；轮次按 `writer.instanceId + sampleSequence` 关联，不能跨实例只比序号。测试历史夹具和实际采样分目录保存，不混称真实历史。

Desktop 按[证据规则](../../.agents/rules/verify-evidence.md)保留每条操作路径前后截图和全过程短视频；内存采样是否成功仍以磁盘证据为准，不以窗口能打开为准。CLI 保存日志和 HTTP/磁盘结果即可。证据在 cleanup 前保存到既有 evidence 目录，token 不进入报告，不复制未脱敏 `daemon.pid`；截图/视频不提交到 git，随对应 PR 附件交付。

每条失败路径也必须恢复被暂停的进程、停止受控子进程并保存失败证据。最后 cleanup 后核对本轮 daemon、sidecar、Electron 和测试子进程确已退出，不能只删目录。没有执行记录、缺少证据、缺真实 Pi 或未跑打包态时，只报告具体缺口，不把文档检查、单测或模型推演写成“端到端已通过”。
