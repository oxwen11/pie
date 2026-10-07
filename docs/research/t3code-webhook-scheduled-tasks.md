# t3code：定时任务的 webhook 触发与离线 hold

## 调研范围与版本

核对版本：[`9bd1d8009a6b7c50f9dd9458e2bf27d481ff3b43`](https://github.com/pingdotgg/t3code/commit/9bd1d8009a6b7c50f9dd9458e2bf27d481ff3b43)，提交时间 `2026-10-06T04:38:02-05:00`。源码位于 `/tmp/github.com/pingdotgg/t3code`；“最新”仅指本次核对时刻。

涉及的合并 PR：#15085（服务端）、#15086（relay 转发）、#15087（mobile）、#15088（web）、#15487（离线 hold）、#15907（agent secrets）、#16232（capability 下沉到 service）。这些 PR 正文为空，结论来自代码；内部文档只有 `docs/internals/t3-connect.md`，其中路径写作 `/v1/hooks/:environmentId/...`，代码实际使用 `endpointKey`，文档已过期。

本文是源码调研，不代表 Pie 已实现这些能力，也没有运行验证。它支撑 [Hub RFC](../rfc/pie-hub.md) 的对比，不是 Pie 的设计决定。

## 结论

1. **webhook 是定时任务的一种触发类型，不是另一种任务。** `schedule` 取 `interval | fixed_time | webhook`；webhook 触发的 prompt 由请求渲染而来，所以“立即运行”对它隐藏。
2. **环境端路由不鉴权，token 就是凭据。** 公开 URL 为 `/v1/hooks/<endpointKey>/<taskId>/<token>`；签名（HMAC）可选。
3. **relay 只转发，不校验 token。** relay 给每个请求签发绑定环境、投递 id、hook 和接收时间的 JWT，环境端验证后才信任 relay 加的头。
4. **离线 hold 需要用户主动开启。** 每个 endpoint 一个 Durable Object，用自带 SQLite 存请求，alarm 驱动重试。
5. **202 之后没有恢复机制。** 请求被确认并从 relay 删除后，如果进程内的后台任务崩溃，这次投递丢失。
6. **token 与请求体在 hold 期间明文落盘**，签名密钥与 token 也明文存于 SQLite。

## 数据模型

- 契约 `packages/contracts/src/scheduledTask.ts:87-97`：`{ type: "webhook", signature: null | { header, encoding: hex|base64, prefix }, maxDeliveryAgeMinutes?: 1..1440 }`。写入变体多出 `secret?` 与 `secretRef?`；读取模型只返回 `hasSecret`。
- `scheduled_tasks`（迁移 057）新增 `webhook_token`、`webhook_secret` 两列，不放进 `schedule_json`，均为明文。
- `scheduled_task_webhook_deliveries`（迁移 057）：投递日志，每任务保留 50 行，body 与渲染后 prompt 各 64 KB 上限；query 与 headers 脱敏后存储，body 原样存储。
- `scheduled_task_webhook_relay_deliveries`（迁移 058）：`relay_delivery_id` 主键，保留 48 小时，长于 relay 的 24 小时 hold，因为日志只留 50 行。
- relay 的 Postgres `relay_environment_links.hold_webhooks_while_offline` 默认 `false`。

## 请求链路（环境端 `webhookRoute.ts`）

1. 路由 `/api/hooks/:hookId/:token`，GET/POST/PUT/PATCH，原始、无鉴权，不入 trace。
2. 请求体 1 MiB 上限（先看 content-length，再用受限 reader），超出返回 413。
3. 验证 relay 投递凭证，早于任何任务查询。
4. token 常量时间比较；未知 hook、非 webhook 任务、token 错误都返回同一个 404。
5. 以 relay 投递 id 做 `INSERT ... ON CONFLICT DO NOTHING` 认领；冲突返回 202 `duplicate`。
6. 每任务每分钟 60 次的内存滑动窗口限流；超限返回 429 并释放认领。限流发生在启用与签名检查之前，签名错误的洪水会消耗正常配额。
7. 任务已暂停：409。
8. HMAC-SHA256 验签（可带前缀，hex 或 base64），失败 401，且不释放认领。
9. `maxDeliveryAgeMinutes` 与接收时间比较，过旧返回 410。接收时间被截到当前时刻。
10. 渲染 prompt；超过 provider 上限记 `dispatch_failed`，返回 202 `prompt_too_long`，认领保留。
11. 每任务队列 20 条；超出返回 429 `queue_full` 并释放认领。
12. 记入日志，在服务 scope 里按任务 `Semaphore(1)` 顺序 fork 执行，立即返回 202 `{deliveryId}`。

每个响应都带 `x-t3-hook-outcome`：`body_too_large | accepted | duplicate | prompt_too_long | not_found | rejected_signature | disabled | rate_limited | queue_full | expired | error`。

运行阶段会重新读取任务，若已删除、被重建（`createdAt` 不同）、切换了触发类型或被暂停就跳过。发送使用 `commandId = scheduled-task:<taskId>:webhook:<deliveryId>`；无绑定线程时启动新线程，否则以 `mode: "queue"` 发送到已有线程。

模板只支持 `{{body.a.b}}`、`{{headers.x}}`、`{{query.x}}`、`{{body}}`、`{{request}}`，单遍替换，无过滤器与条件。缺失值渲染为空并记录；整体渲染对 token/secret/signature/key/password/auth 类字段脱敏，但显式写 `{{headers.authorization}}` 会返回原值。

## relay 转发与离线 hold

**转发**（`infra/relay/src/hooks/HookForwarder.ts`）

- `endpointKey` 是托管隧道名的 16 位十六进制尾段，用来隐藏环境 id。
- 通过已存的 allocation 找到活动链接与 `httpBaseUrl`；上游 URL 仅由该基址加原始路径片段构成，`redirect: manual`，响应上限 64 KB，超时 8 秒。
- relay 侧限流：每个 hook URL 哈希每分钟 60 次，每 endpoint 每分钟 600 次，限流器出错时放行。
- 剥离 `host`、hop-by-hop 头、`cookie`、`proxy-*`、`cf-*`、`x-forwarded-*`、发送方的 `x-t3-relay-*` 与 trace 头；加入 `x-t3-relay-delivery-id`、`x-t3-relay-received-at` 与 `x-t3-relay-delivery`。
- 返回给发送方的头仅限 content-type、nosniff 与沙箱 CSP。

**投递凭证**：`x-t3-relay-delivery` 是用云端 mint key 签名的 JWT，声明包含 `iss`、`aud = t3-env:<envId>`、`jti`、`exp`（+25 小时）以及 `environmentId`、`deliveryId`、`receivedAt`、`hookId`。环境端核对签名、类型、issuer、audience 和最大年龄，并要求声明与请求头、路由一致；验证失败或缺失，则按直连处理，不使用 relay id 与 trace，接收时间取当前。

**hold**（`HookInboxObject.ts`、`HookInboxStore.ts`）

- 仅当链接已开启时生效；上游出错、超时或返回 502/503/504/530 触发 hold，发送方得到 202 `{queued:true}`。
- 满了返回 503 `inbox_full`；未开启 hold 时，不可达返回 503 或 504。
- 上限 1000 条、50 MiB、每 hook 100 条，TTL 24 小时，在同一条 INSERT 中强制。
- `held_hooks` 保存 seq、id、received_at、method、raw_hook_id、**raw_token**、hook_key、query、headers（含凭证）、body。
- alarm 每次投递 20 条，每个 hook 内按到达顺序。对响应的处理：502/503/504/530 或超时保留全部并退避（10 秒×18，之后从 30 秒指数退避至 10 分钟）；429/500 将该 hook 标记为忙，30 秒后重试，同时继续投递其他 hook；其他状态（包括 401、404、410）删除请求。
- 隧道连上时 `wakeHeldHooks`（3 秒去抖，重试 3 次）重置失败计数并立刻触发 alarm。关闭开关会清空 inbox。
- 设计理由（`docs/internals/t3-connect.md:27-30`）：不用 Postgres 与 Queues，因为 Queues 单条消息上限 128 KB，也无法单独挂起某个环境的请求。

## 幂等与崩溃

- 投递 id：relay 路径是 `delivery:relay:<id>`，直连是随机 `delivery:<uuid>`，**直连没有去重**。
- 认领只对通过验证的 relay 投递存在；`rate_limited` 与 `queue_full` 释放，让 hold 重试可用；已启用但失败、验签失败、过期、`prompt_too_long`、成功都保留，这些返回 4xx 或 202，relay 视为已送达并删除。
- 认领与日志之间的崩溃由 `Effect.uninterruptible` 覆盖；202 之后进程内 fork 的任务崩溃则丢失，没有恢复扫描。`commandId` 由投递 id 派生，因此不会二次启动。

## 安全观察

- token 在 URL 路径：relay span 与服务端不记录，但 hold 期间的 raw token 与完整 body 明文存于 Durable Object SQLite，内部文档有披露。
- 没配置签名时，token 是唯一凭据；非 relay 路径上，被截获的请求可被持有 URL 的任何人重放。
- 未发现 SSRF：上游主机来自已验证的 allocation，不跟随重定向。
- relay 头仅在 JWT 验证通过时才被信任，接收时间被钳制，处理得好。
- agent secrets（#15907）：agent 调用 MCP `request_secret`，用户在私密卡片里回答，值直接进 `ServerSecretStore`；ref 为 HMAC(salt, threadId+turnItemId)，一次性、绑定项目、24 小时 TTL，每小时清扫。agent 能看到 webhook URL（含 token），但看不到签名密钥。

## 用户界面

设置里的 Scheduled Tasks 选择 “On webhook”，prompt 默认 `Handle this webhook:\n{{body}}`。首次保存前提示“保存后才显示 URL”，之后显示只读 URL，可复制或轮换（需确认，旧 URL 立即失效）。没有测试按钮，只有投递日志对话框（脱敏日志、渲染后 prompt、缺失字段）。`runNow` 对 webhook 任务被服务端拒绝：“Webhook tasks run when their URL receives a request.”

## 对 Pie Hub 的启示

可借鉴：relay 签名的投递凭证；去重记录保留时间长于 hold TTL，且仅在可重试结果上释放；Durable Object + SQLite + alarm 的 hold，带 TTL、总量与单 hook 上限、忙与不可达的区分退避、重连唤醒；运行前复核任务状态；模板只允许取值并脱敏；hold 默认关闭，关闭即清空。

不适用：Cloudflare 隧道与 DNS 分配，以及 relay 推送加“靠响应码推断环境是否在线”。Pie 的 daemon 主动外连，Hub 应持有请求直到 daemon 在线，再以显式 ack/nack 取代状态码推断。

应避免：202 之后没有崩溃恢复；token 与请求体明文落盘（Pie 用 GitHub 自己的 HMAC，不需要路径 token，也不保存原始请求体）；密钥放进 URL 路径；限流先于签名检查；文档与代码路径不一致。
