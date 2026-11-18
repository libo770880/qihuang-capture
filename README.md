# 岐黄鉴方采集助手 - 完整版

中医智能辨证采集助手（岐黄鉴方）双版本发布包。

## 目录结构

- `Electron版/` — Electron + Node.js 版（主程序 `main.js`，含 PP-OCRv6 OCR 模型）
- `NET宿主版/` — .NET 8 WPF + WebView2 宿主版（`QhijfCapture` 宿主）
- `使用说明.txt` — 使用说明

> 本仓库为发布包快照，源码主仓库见 capture-tool 项目。

## 仓库说明

- `Electron版/runtime/electron.exe`（246MB）超过 GitHub 单文件 100MB 限制，未入库。
  补回方法：下载与 `package.json` 中 electron 版本号一致的 Electron 预编译包，
  将其中的 `electron.exe` 重命名后放入 `Electron版/runtime/` 即可。
- 各版本 `app/userdata/`（用户数据与采集记录）不入库，首次运行自动生成。
