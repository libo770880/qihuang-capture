# 岐黄鉴方 · 悬浮采集助手

面向中医医院的病历/医嘱采集与 AI 质控入口：悬浮球采集 → 结构化解析 → 中医辨证 → 处方安全审方（配伍禁忌 / 医保规则 / 点评红线），数据全部本地存储。

> 本仓库是**发布分发仓库**：存放已编译的发布包、版本清单 `latest.json` 与更新说明。
> 主程序源码在院内开发仓库，不在此公开。

- 最新版本：**v0.2.0**（2026-11-18）
- 下载：[Releases](https://github.com/libo770880/qihuang-capture/releases)
- 参赛：第一届山东省中医药创新创业大赛 · 创业团队组 · 赛道③ 中医药智造与数字创新

---

## 一、两个版本，功能一致、数据互通

| 发布包 | 说明 | 启动方式 | 体积 |
|---|---|---|---|
| `Electron版/` | 自带 Chromium，兼容性最好，无需任何运行库 | 双击 `启动岐黄鉴方.vbs` | 约 632 MB |
| `NET宿主版/` | .NET 8 WPF + WebView2 宿主，启动更快、内存更低，需系统有 WebView2 Runtime（Win11 / 新版 Win10 已内置） | 双击 `启动 岐黄鉴方采集助手.vbs` | 约 451 MB |

两个版本共用同一套页面与同一份 `app\userdata\data.db`，任选其一使用，**请勿同时运行**。
换版本时把 `data.db` 复制到另一版 `app\userdata\` 即可无缝继续（先退出程序）。

系统要求：Windows 10 1809+ / Windows 11，64 位，内存 4 GB+（建议 8 GB）。

---

## 二、软件更新（v0.2.0 新增）

### 2.1 在哪儿

后台管理 → **系统设置 → 软件更新**（系统设置页顶部第一张卡片）。

卡片上显示：当前版本号、宿主类型（Electron 版 / .NET 宿主版），以及以下几个按钮：

| 按钮 | 行为 |
|---|---|
| 检查更新 | 读取 GitHub 上的版本清单 `latest.json`，与本地版本比较；有新版本时列出**版本号、发布时间、更新说明、更新包大小** |
| 下载更新包 | 下载本宿主对应的整包 zip，边下边显示进度，完成后按清单里的 **SHA-256 校验**；校验不通过直接中止，不会安装 |
| 重启并完成更新 | 退出软件 → 自动解压覆盖程序文件 → 自动重新启动（通常 10~60 秒） |
| 打开发布页 | 浏览器打开 Releases 页面，可手动下载 |

打开「系统设置」时会**自动静默检查一次**（失败不弹窗打扰，只影响手动检查的结果）。

### 2.2 更新过程做了什么

```
点「重启并完成更新」
  → 生成 app\userdata\updates\update.bat
  → 宿主退出
  → bat 等待本进程 PID 消失（循环等待，不靠固定 sleep）
  → PowerShell Expand-Archive 解压到 updates\stage\
  → robocopy stage → 版本目录（/E /IS /IT，**不带 /PURGE**）
  → 删除 stage 与 zip，启动启动脚本，bat 自删
```

**更新只覆盖程序文件**，以下内容不受任何影响：

- `app\userdata\data.db`（设置 / 账号 / 知识库 / 采集记录）
- `app\userdata\records\`（记录截图）、`backups\`
- 你自己放进版本目录里的其他文件（覆盖式安装，不做清理）

### 2.3 网络要求与镜像

更新走 GitHub（`raw.githubusercontent.com` 取清单，`github.com` 取更新包）。
国内网络直连经常失败，程序会**自动回退到公共镜像重试**：

```
直连 → https://ghfast.top/ → https://gh-proxy.com/     （每个通道内再重试 3 次）
```

三个通道全部失败时，卡片会显示每个通道的失败原因。
此时可点「打开发布页」手动下载 zip，解压后覆盖到版本目录——效果与自动更新相同，数据同样不受影响。

### 2.4 更新失败怎么排查

所有动作都留痕：`<版本目录>\app\userdata\updates\`

| 文件 | 用途 |
|---|---|
| `update.bat` | 退出后实际执行的覆盖脚本（文件还在说明没跑完） |
| `update.log` | 逐阶段日志：`update start` → `expand` → `copy` → `launch`；失败会写 `FAILED` |
| `stage\` | 解压中间目录，正常流程结束会被删除 |

- 卡在 `update start`：宿主进程没退干净（托盘残留），任务管理器结束该进程后脚本会自动继续
- 卡在 `expand`：zip 损坏（重新下载）或磁盘空间不足（需 ≥ 1.5 GB 临时空间）
- 出现 `FAILED`：覆盖失败，此时**旧版本仍然可用**，双击启动脚本即可继续使用
- 5 分钟仍未自动启动：手动双击启动脚本，再看 `update.log` 确认落到哪个版本

---

## 三、目录结构

```
岐黄鉴方采集助手-完整版/
├─ 使用说明.txt                面向使用者的说明（包内）
├─ latest.json                 版本清单：更新功能的唯一版本源（本仓库根目录）
├─ Electron版/
│  ├─ 启动岐黄鉴方.vbs          双击入口（无控制台窗口）
│  ├─ runtime/                 Electron 运行时（electron.exe 不入 git，见第六节）
│  └─ app/                     主程序：main.js / preload.js / renderer / lib / data / vendor
│     └─ userdata/             用户数据（不入 git，见第六节）
└─ NET宿主版/
   ├─ 启动 岐黄鉴方采集助手.vbs
   └─ app/                     QhjfCapture.exe + .NET 8 运行时 + 同套 renderer/lib
      └─ userdata/
```

---

## 四、更新机制原理（维护者 / 评审）

### 4.1 版本源：`latest.json`

仓库根目录的 `latest.json` 是**唯一版本事实来源**。选它而不选 GitHub API 的原因：
可直接走镜像、无 API 限流（未认证 60 次/小时）、结构自定义、两种宿主解析逻辑完全一致。

```json
{
  "version": "0.2.0",
  "publishedAt": "2026-11-18",
  "notes": "更新说明（换行用 \\n，直接显示在更新卡片里）",
  "assets": {
    "electron": { "name": "...zip", "url": "https://github.com/.../releases/download/v0.2.0/...zip",
                  "size": 404127450, "sha256": "759ff75f…" },
    "net":      { "name": "...zip", "url": "...", "size": 320619760, "sha256": "6fbe49b0…" }
  }
}
```

`assets` 按宿主类型分键：`electron` 给 Electron 版、`net` 给 .NET 宿主版——页面不需要知道自己在哪个宿主里。
清单先试 `main` 分支、再试 `master`，避免分支改名后更新功能失灵。

### 4.2 通道清单（两宿主同名同义）

| 通道 | 参数 | 返回 |
|---|---|---|
| `update:info` | — | `{ok, host, version, repo, page, appRoot, portable}` |
| `update:check` | — | `{ok, current, latest, hasUpdate, notes, publishedAt, asset{name,url,size,sha256}, source}` |
| `update:download` | `asset` 对象 | `{ok, path, bytes, sha256, mirror}`，失败 `{ok:false, error}` |
| `update:apply` | `{zipPath}` | `{ok, bat, log, launching}`，成功后宿主约 0.4 s 后退出 |
| `update:progress` | 事件 | `{got, total, p}`（下载时每 200 ms 推一次） |

实现位置（**两侧必须保持镜像一致**）：

| 层 | Electron 版 | .NET 宿主版 |
|---|---|---|
| 主进程 / 宿主 | `app/lib/updater.js` + `app/main.js` 注册 | `net/QhjfCapture/Domain/Update.cs` + `Domain/Channels.cs` 注册 |
| 页面桥 | `app/preload.js` | `assets/shim.js`（WebView2 版 preload 复刻） |
| 界面 | `renderer/admin.html`（两版同一份，`updInit/updCheck/updDownload/updApply`） | 同左 |

### 4.3 安全设计

- **只走 https**：清单与包地址非 https 直接拒绝
- **SHA-256 强校验**：期望值写在 `latest.json` 里，下载完先算哈希再落地；不一致立即删除并中止
- **只覆盖安装目录**：`robocopy /E /IS /IT`，**不带 `/PURGE`**，`userdata\` 与用户自建文件永不被删
- **不做提权**：更新在用户权限下执行，不写系统目录、不改注册表
- **开发态拒绝安装**：只有 `<版本根>/app` + `runtime/`（或 `app` 根）这种发布布局才允许 `update:apply`，避免改坏源码工程
- **失败可回退**：robocopy 逐文件覆盖、失败即停，旧文件仍在，手动启动仍是可用版本
- **信任边界**：`latest.json` 与 zip 同源（GitHub）。若仓库账号被盗，攻击者可发布恶意更新——仓库应开启两步验证，`main` 分支只允许本人推送

### 4.4 为什么用 bat + robocopy，而不是 `electron-updater`

`electron-updater` 依赖 NSIS 安装器与 `latest.yml`，本项目是**免安装绿色包**（双击 vbs 启动），装不了。
自建方案的好处：两宿主共用同一套覆盖逻辑、行为可读可审计、日志落在用户数据目录里，便于现场排查。

---

## 五、发版流程（维护者清单）

以发布 `v0.2.1` 为例：

```bash
# 1) 改版本号（两处必须同值，app:version 通道不因宿主漂移）
#    app/package.json                     "version": "0.2.1"
#    net/QhjfCapture/Ui/HostWindow.cs     AppInfo.Version = "0.2.1"

# 2) 编译 + 装配完整发布目录
dotnet publish net/QhjfCapture -c Release -r win-x64 --self-contained true -o net/dist-host
node scripts/_pack_release.js        # Electron 版（保留 app\userdata）
node scripts/_pack_host.js           # .NET 宿主版
node scripts/_pack_full.js           # 装配 完整版/

# 3) 打更新包（zip；Windows 自带 Expand-Archive 可解；自动排除 userdata）
python scripts/_pack_update_zip.py   # 输出两个 zip 的 size 与 sha256

# 4) 更新本仓库根目录 latest.json（version / publishedAt / notes / 两个资产的 size+sha256+url）

# 5) 同步发布目录到本仓库并提交（latest.json 必须一起提交）
git add -A && git commit -m "release: v0.2.1" && git push

# 6) 建 tag 与 Release，上传两个 zip 作为附件
#    资产名必须严格为 qhjf-electron-v0.2.1.zip / qhjf-net-v0.2.1.zip
#    （latest.json 里的 url 指向它们，名字不一致会 404）
```

**发版自检**：用上一版程序打开「系统设置 → 软件更新」→ 检查更新 → 应显示新版本与说明 → 下载 → 校验通过 → 重启更新 → 版本号已更新，且采集记录 / 知识库 / 账号全在。

---

## 六、仓库约定与隐私

**不纳入版本库的内容**（`.gitignore` 强制，打包脚本同样排除）：

| 路径 | 原因 |
|---|---|
| `Electron版/runtime/electron.exe` | 246 MB，超过 GitHub 单文件 100 MB 限制。补回方法：按 `app/package.json` 里的 electron 版本下载官方预编译包，把 `electron.exe` 改名后放入 `runtime/` |
| `**/app/userdata/` | 真实采集记录与配置（含患者相关文本），**公开仓库绝不上传** |

因此从本仓库直接 clone 得到的目录**不能开箱运行**：缺 `electron.exe`，也没有你的数据。
正确用法是下载 Release 里的 zip（整包，含运行时、不含任何用户数据）。

其他约定：

- 更新包 zip 内**不含** `userdata/`、`logs/`、`*.log`、`portable.dat`
- `latest.json` 手工维护（不用脚本生成），保证评审时能直接读懂版本与校验值
- 提交信息用中文，说明改了什么、为什么

---

## 七、常见问题

**Q：点「检查更新」提示失败，但浏览器能打开 GitHub？**
A：程序走的是宿主自己的网络栈（.NET 会读 `HTTP_PROXY` 环境变量，公司代理需放行 `raw.githubusercontent.com` 与 `github.com`）。三个通道都失败时，手动下载 zip 覆盖即可。

**Q：两个版本能互相更新吗？**
A：不能。Electron 版只下 `qhjf-electron-*.zip`，.NET 宿主只下 `qhjf-net-*.zip`（清单按宿主分键）。要换宿主，请手动下载另一版整包。

**Q：更新后数据会不会丢？**
A：不会。更新只覆盖程序文件，`app\userdata\` 完全不碰。仍建议更新前在「系统设置 → 数据备份」点一次「立即备份」。

**Q：更新卡住怎么办？**
A：见 2.4 节，看 `app\userdata\updates\update.log` 停在哪一阶段；旧版本始终可用。

---

## 八、许可

内部与参赛用途发布。第三方组件（Electron、.NET 运行时、PaddleOCR / PP-OCRv6 模型、tesseract.js 语言包等）遵循各自许可证，随包保留原许可文件。
