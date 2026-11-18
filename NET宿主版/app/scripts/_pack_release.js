// 打包发布版：release/岐黄鉴方采集助手/
//   岐黄鉴方采集助手.exe  ← 极小 C# 启动器（另由 csc 编译，脚本只负责目录装配）
//   runtime/              ← Electron 44 运行时（locales 只留 zh-CN/en-US）
//   app/                  ← 应用源码 + 生产依赖闭包（无 electron）
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REL = path.join(ROOT, 'release', '岐黄鉴方采集助手');
const RUNTIME = path.join(REL, 'runtime');
const APP = path.join(REL, 'app');

function copyDir(src, dst, filter) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name), d = path.join(dst, name);
    if (filter && !filter(name, s)) continue;
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d, filter);
    else fs.copyFileSync(s, d);
  }
}

console.log('清理旧产物...');
// 便携数据保护：发布目录内 app\userdata 是用户真实数据（记录/配置/知识库）。
// 旧实现用 renameSync 整体挪出，用户还在运行程序时 data.db 被独占 → EBUSY 中断打包。
// 现在不搬文件，直接「逐项清理、原地保留 app\userdata」，装配时只覆盖程序文件。
// 中断恢复：上一版可能把数据留在 .tmp-userdata-* 里，这里先迁回。
const guard = require('./lib/packguard');
const KEEP = path.join(APP, 'userdata');
try {
  const leftovers = fs.readdirSync(ROOT)
    .filter(n => n.startsWith('.tmp-userdata-'))
    .map(n => ({ p: path.join(ROOT, n), t: fs.statSync(path.join(ROOT, n)).mtimeMs }))
    .filter(x => fs.existsSync(path.join(x.p, 'data.db')))
    .sort((a, b) => b.t - a.t);
  if (!fs.existsSync(path.join(KEEP, 'data.db')) && leftovers.length) {
    if (fs.existsSync(KEEP)) guard.rmrf(KEEP);
    fs.renameSync(leftovers[0].p, KEEP);
    console.log('已从上次中断的临时目录恢复便携数据');
  }
} catch (e) { console.warn('中断数据恢复失败：' + e.message); }
guard.assertNoRunning(REL, { force: process.argv.includes('--force-close') });
if (fs.existsSync(REL)) {
  const r = guard.cleanKeep(REL, [path.join('app', 'userdata')]);
  console.log('已清理 ' + r.removed + ' 项（app\\userdata 原地保留）');
}

console.log('复制 Electron 运行时...');
copyDir(path.join(ROOT, 'node_modules', 'electron', 'dist'), RUNTIME, (name) => {
  if (name !== 'locales') return true;
  return false; // locales 目录单独处理
});
// locales 只留中文/英文
copyDir(path.join(ROOT, 'node_modules', 'electron', 'dist', 'locales'), path.join(RUNTIME, 'locales'),
  (n) => n === 'en-US.pak' || n === 'zh-CN.pak');

console.log('复制应用源码...');
fs.mkdirSync(APP, { recursive: true });
for (const f of ['main.js', 'preload.js', 'package.json']) fs.copyFileSync(path.join(ROOT, f), path.join(APP, f));
for (const d of ['lib', 'renderer', 'build', 'data', 'scripts']) copyDir(path.join(ROOT, d), path.join(APP, d));
// vendor 带 tessdata + ocr_env（OCR 环境一键离线安装包；tesscache 为运行时产物不带）
copyDir(path.join(ROOT, 'vendor', 'tessdata'), path.join(APP, 'vendor', 'tessdata'));
if (fs.existsSync(path.join(ROOT, 'vendor', 'ocr_env'))) {
  // wheels-paddle 为可选增强（~209MB），为控包体不随包分发；
  // 缺省时安装器自动走 wheels/ 的 RapidOCR(ONNX) 通道，识别模型同源（scripts/models/PP-OCRv6_*.onnx）
  copyDir(path.join(ROOT, 'vendor', 'ocr_env'), path.join(APP, 'vendor', 'ocr_env'),
    (name) => name !== 'wheels-paddle');
}
// 运行时缓存守卫：本次构建若在打包后跑过自检（--smoke），tesseract 会在 app/vendor/tesscache 落缓存
// （约 65MB 冗余），重新打包时统一清掉，避免把运行时产物带进发布包
guard.rmrf(path.join(APP, 'vendor', 'tesscache'));

console.log('复制生产依赖（node_modules 去除 electron 与未引用的 @tesseract.js-data）...');
// @tesseract.js-data（chi_sim+eng 共 ~35MB）运行时不 require：tess.js 恒设 langPath=vendor/tessdata，
// 该包仅在 tesseract.js 内部作为「langPath 未设置时的 CDN 兜底 URL」存在，故不入包。
copyDir(path.join(ROOT, 'node_modules'), path.join(APP, 'node_modules'),
  (name) => name !== 'electron' && name !== '@tesseract.js-data');

// ---------- 便携数据目录（数据随包，搬家不丢配置） ----------
// app\userdata 存放 data.db / records / knowledge / config；首启自动从 %APPDATA% 迁移旧数据。
// 该目录在清理阶段已原地保留（不参与删除、不搬移），这里只补标记文件。
fs.mkdirSync(KEEP, { recursive: true });
fs.writeFileSync(path.join(KEEP, '.portable'), '数据随包存放；删除本文件则回到 %APPDATA% 模式\r\n', 'utf8');

console.log('写极小启动器（VBS，无闪窗）...');
fs.writeFileSync(path.join(REL, '启动岐黄鉴方.vbs'),
`' QHJF Capture Assistant - minimal launcher (folder-relative, no console window)
Option Explicit
On Error Resume Next
Dim sh, base, electron, appDir
Set sh = CreateObject("WScript.Shell")
base = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\\"))
sh.Environment("PROCESS").Remove "ELECTRON_RUN_AS_NODE"
sh.Environment("PROCESS").Remove "ELECTRON_NO_ATTACH_CONSOLE"
electron = """" & base & "runtime\\electron.exe"""
appDir = """" & base & "app"""
sh.CurrentDirectory = base & "app"
sh.Run electron & " " & appDir & " --no-sandbox --disable-gpu", 1, False
`, 'ascii');

console.log('写启动说明...');
fs.writeFileSync(path.join(REL, '启动说明.txt'),
`岐黄鉴方 · 悬浮采集助手（发布版）

【启动】双击「启动岐黄鉴方.vbs」即可（无黑窗闪现），托盘出现悬浮球。
【退出】右键悬浮球 → 退出。
【重复双击】安全——应用自带单实例锁，二次启动只会唤出已有界面。

【目录说明】
  runtime/   Electron 运行时（请勿改动）
  app/       应用程序（源码与知识库、OCR 语言包）

【数据位置】全部设置与数据都在一个文件里：
  app\\userdata\\data.db
  · 含：后台设置 / 账号科室 / AI 模型 / AI 补库队列 / 文字纠错 / 预设库 / 清理规则 / 点评红线 / 采集记录
  · 搬家：拷 app\\userdata\\data.db 一个文件到新机器同一位置即可（约 10MB，无需搬整个目录）
  · 截图与备份另存 app\\userdata\\records、backups，按需一并拷走
  · 运行缓存（WebView2 / Local Storage）已外置到 %LOCALAPPDATA%\\岐黄鉴方采集助手-缓存，不随包搬家
  · 升级：打包脚本自动保留 app\\userdata，不会被清掉
  · 首次以新版启动时，若 app\\userdata 内没有 data.db，会自动从旧的
    %APPDATA%\\岐黄鉴方·悬浮采集助手\\ 迁移配置与记录
  · 想回到系统目录模式：删除 app\\userdata\\.portable 即可
  · 后台「系统设置 → 数据搬家」可导出配置包（.qhcfg）或整库，并有配置入库审计

【热键】Ctrl+Alt+V 粘贴采集（在医院系统复制病历/医嘱后按）
`, 'utf8');

const size = (p) => { let t = 0; for (const f of fs.readdirSync(p)) { const s = fs.statSync(path.join(p, f)); t += s.isDirectory() ? size(path.join(p, f)) : s.size; } return t; };
console.log('完成。runtime', (size(RUNTIME) / 1048576).toFixed(0) + 'MB', '| app', (size(APP) / 1048576).toFixed(0) + 'MB');
