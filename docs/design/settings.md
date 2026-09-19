# Settings：裸 JSON 用户偏好

- 状态：已落地。host persistence inventory 已更新。
- 取代未合并的 #74 / #75（三 owner 合一文件、TOML、`{ version, data }` 信封）。
- 对照：T3 Code（`pingdotgg/t3code`）是架构参考；LobeHub 只借设置页名 Appearance。

## 文件

`$PIE_HOME/settings.json`。`Paths` 增加 `settingsFile`。不进 `storage/`（那是记录集合）。

缺文件 = 内存默认值，不创建。第一次 Settings **save** 才写出。权限跟现有 server JSON 一样靠 umask。无产品级卸载。

## 字段组织

根键 = 设置页，页内字段平铺。不按进程 owner 切（`ui` / `desktop` / `server` 不是键）。Desktop 宿主状态进 Electron，不出现在这份 JSON。

v1：

```json
{
  "appearance": {
    "theme": "system"
  }
}
```

`theme`：`"system"` | `"light"` | `"dark"`。页内以后加的对比度、字号也平铺在 `appearance` 下，不再套第三层。另一个设置页才加与 `appearance` 平级的根键；空对象不写。

对照 T3 `ClientSettingsSchema`：Appearance 页上的字段摊成前缀扁平键（`appearanceContrast`、`fontSizeInterface`），主题不在该文件里。Pie 不抄前缀 — 页叫 Appearance 就用对象 `appearance`。

不要根上的 `"theme"`、`ui.theme`、T3 式 `appearanceContrast`。

## 读写

不用 `makeJsonDocument`。信封是 storage 记录的格式。

用 Effect Schema decode/encode + 已导出的 `writeFileAtomic`（daemon.pid 同路）。Repository 内信号量串行化。

- 缺键 → 默认（`appearance.theme = "system"`）
- 认识的键值非法 → fail loud，不改文件
- 损坏 / 非 JSON → fail loud，不自动重置
- 未知键 → 写回丢掉
- 破坏性变更以后再加顶层平级 `"version": 2`。现在不加

## Theme

`pie:theme` localStorage **留下**，当 FOUC 缓存。server 是源：Settings 保存写 `settings.json` 并更新 localStorage。早 bootstrap 仍读 localStorage；连上 daemon 后 `settings.get` 对齐。这样 `pie://app` 和浏览器 origin 共用同一主题。

设置页分组名 **Appearance**，控件改 `appearance.theme`。

## 对照

真正能抄的是 **T3 Code**（Pie 桌面架构本来就拿它当 peer）。LobeHub 没有一份给人看的 settings JSON。

T3 按 **owner 拆文件**，Effect Schema，无 `{ version, data }` 信封，缺键 `withDecodingDefault`：

| 文件                        | 谁写                      | 内容                                                                                                         |
| --------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `client-settings.json`      | renderer / Desktop IPC    | UI 偏好：字体、对比度、sidebar… **扁平**键（`fontSizeInterface`、`appearanceContrast`），不是 `appearance.*` |
| `desktop-settings.json`     | Main，daemon 起来之前就读 | 窗口 bounds、exposure、update channel、WSL                                                                   |
| server settings             | server                    | 模型 / provider；主题默认用 `t3 theme set`，不进 client 文件                                                 |
| `localStorage t3code:theme` | 每个 origin               | 主题。文档写明：Appearance **按设备/浏览器分开存**                                                           |

源：`packages/contracts/src/settings.ts` `ClientSettingsSchema`、`apps/desktop/src/settings/{DesktopClientSettings,DesktopAppSettings}.ts`、`apps/web/src/hooks/useTheme.ts`、`docs/user/appearance.md`。

Pie 抄 T3 的拆法，不抄「主题只放 localStorage」：

|               | T3                                 | Pie                                                                     |
| ------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| 用户偏好 JSON | `client-settings.json`，扁平       | `$PIE_HOME/settings.json`，根键跟设置页走 → `appearance.theme`          |
| 读写          | Effect Schema + tmp rename         | 同，用已有 `writeFileAtomic`                                            |
| 缺键          | decode 填默认                      | 同                                                                      |
| Desktop 窗口  | `desktop-settings.json`，Main 独占 | Electron userData，以后才做                                             |
| 主题          | 每 origin 一份 localStorage        | `settings.json` 为源，让 `pie://app` 和浏览器共用；localStorage 只 FOUC |

LobeHub 只借页名 `Settings → Appearance`。它的主题在 `next-themes` + electron-store `themeMode`，用户设置在 Postgres 分列，没有 `appearance.theme` 这个字段。

## 不做

- TOML / smol-toml
- `{ version, data }` 信封，或 `makeJsonDocument`
- JSON 根键用进程 owner（`ui` / `desktop` / `server`）
- 一份文件三个 writer
- 空领域占位
- 代理 Pi 设置或默认模型
- 把 `PIE_*` 或窗口 bounds 放进 `settings.json`
- next-themes 当主题源（LobeHub 那样 web/desktop 主题会按 origin 分裂）

## 落地顺序

contract schema + RPC → server repository/RPC → `/settings` Appearance 接 `appearance.theme`。host-persistence 的 shipped 条目只在真正写出文件的 slice 里改。
