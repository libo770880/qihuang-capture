// 打包 .NET 宿主发布版：release/岐黄鉴方采集助手-net/
//   启动 岐黄鉴方采集助手.vbs   ← 双击入口（无控制台窗口）
//   app/                        ← 目录装配的唯一产物，结构如下：
//     QhjfCapture.exe           ← self-contained apphost
//     *.dll / *.json            ← .NET 8 运行时（含 WPF、WebView2 托管层）
//     renderer/ data/ scripts/ vendor/ build/
//
// 【为什么不拆 runtime/】
// Electron 版能拆（release/岐黄鉴方采集助手/runtime/ + app/），是因为 Electron 的
// 主 exe 会按自己所在目录之外的相对路径去找 app/。**.NET self-contained 不行**：
// apphost 必须与 hostpolicy/hostfxr 及各托管 DLL **同目录**，拆开就要额外配
// DOTNET_ROOT 或改 runtimeconfig，收益为零、风险不小。
// 于是宿主 exe 落在 app/ 根，renderer/ 作为它的同级目录 —— 这刚好命中
// AppPaths.Init() 的「发布态」分支（从 exe 目录向上找含 renderer/ 的祖先，
// exe 目录自身即命中）。改布局前先读 AppPaths.cs，别凭直觉挪 exe。
//
// 用法：node scripts/_pack_host.js
//       然后可选：python scripts/_pack_archive.py release/岐黄鉴方采集助手-net <输出>
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const NAME = '岐黄鉴方采集助手-net';
const REL = path.join(ROOT, 'release', NAME);
const APP = path.join(REL, 'app');
const DIST = path.join(ROOT, 'net', 'dist-host');

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

function dirSize(dir) {
  let total = 0, files = 0;
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n), st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else { total += st.size; files++; }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return { total, files };
}
const mb = (b) => (b / 1048576).toFixed(1) + ' MB';

// ---------- 前置校验 ----------
if (!fs.existsSync(path.join(DIST, 'QhjfCapture.exe'))) {
  console.error('[pack-host] 未找到 net/dist-host/QhjfCapture.exe');
  console.error('            先跑：cd net/QhjfCapture && bash ../dotnet.sh publish -c Release \\');
  console.error('                   -r win-x64 --self-contained true -o ../dist-host');
  process.exit(1);
}

// ---------- 占用检查 + 清理 ----------
// 便携数据保护：app\userdata 是用户真实数据（记录/配置/知识库）。
// 旧实现用 renameSync 把整个 userdata 挪到 .tmp，一旦用户还在运行宿主，
// data.db 被独占 → EBUSY 直接中断打包（2026-10-20 报错即此）。
// 现在改为「原地保留 + 逐项清理」：不搬动任何被锁文件，装配后覆盖非数据文件即可。
const guard = require('./lib/packguard');
const KEEP = path.join(APP, 'userdata');
guard.assertNoRunning(REL, { force: process.argv.includes('--force-close') });

console.log('[pack-host] 清理旧产物...');
if (fs.existsSync(REL)) {
  const r = guard.cleanKeep(REL, [path.join('app', 'userdata')]);
  console.log('[pack-host] 已清理 ' + r.removed + ' 项（app\\userdata 原地保留）');
}
fs.mkdirSync(APP, { recursive: true });

// ---------- 1) 宿主 + self-contained 运行时 ----------
console.log('[pack-host] 复制 .NET 宿主与运行时...');
copyDir(DIST, APP);
// 防御性清理：publish 后本该已删（见技能坑 5），此处再兜一次，
// 免得某次忘了删就把 21MB 的 WinForms 白背带进发布包
for (const n of fs.readdirSync(APP))
  if (/^System\.Windows\.Forms.*\.(dll|xml)$/.test(n)) guard.rmrf(path.join(APP, n));

// ---------- 2) 应用资源（页面/数据/脚本/OCR 预置包） ----------
console.log('[pack-host] 复制应用资源...');
for (const d of ['renderer', 'build', 'data', 'scripts']) {
  copyDir(path.join(ROOT, d), path.join(APP, d));
}
// vendor：tessdata 带（Windows OCR 语言数据），ocr_env 带（一键离线装 OCR 环境），
//         tesscache 不带（那是 JS 版 tesseract 的运行时产物，.NET 宿主根本没有该层）
copyDir(path.join(ROOT, 'vendor', 'tessdata'), path.join(APP, 'vendor', 'tessdata'));
copyDir(path.join(ROOT, 'vendor', 'ocr_env'), path.join(APP, 'vendor', 'ocr_env'),
  (name) => name !== 'wheels-paddle');   // wheels-paddle ~209MB 可选增强，不随包
guard.rmrf(path.join(APP, 'vendor', 'tesscache'));

// ---------- 2.5) 便携数据目录（数据随包，搬家不丢配置） ----------
// app\userdata 存放 data.db / records / knowledge / config；首启自动从 %APPDATA% 迁移旧数据。
// 该目录在清理阶段原地保留，这里只补标记文件。
fs.mkdirSync(KEEP, { recursive: true });
fs.writeFileSync(path.join(KEEP, '.portable'), '数据随包存放；删除本文件则回到 %APPDATA% 模式\r\n', 'utf8');

// ---------- 3) 双击入口 ----------
// WPF 是 WinExe（本就没有控制台），但用户拿到的是一个叫 QhjfCapture.exe 的程序，
// 名字对不上「岐黄鉴方采集助手」；用 VBS 起一个中文名入口，且不闪黑框。
// 引号一律走 Chr(34)，不要在 VBS 源码里数 `""""`——那种拼法极难读且一改就错。
fs.writeFileSync(path.join(REL, '启动 岐黄鉴方采集助手.vbs'), [
  'Option Explicit',
  'Dim fso, sh, base, exePath',
  'Set fso = CreateObject("Scripting.FileSystemObject")',
  'Set sh = CreateObject("WScript.Shell")',
  'base = fso.GetParentFolderName(WScript.ScriptFullName)',
  'exePath = base & "\\app\\QhjfCapture.exe"',
  'sh.CurrentDirectory = base & "\\app"',
  'sh.Run Chr(34) & exePath & Chr(34), 0, False',
  '',
].join('\r\n'), 'utf8');

// ---------- 4) 汇总 ----------
const runtime = dirSize(path.join(APP, 'vendor', 'ocr_env'));
const models = dirSize(path.join(APP, 'scripts', 'models'));
const whole = dirSize(REL);
console.log('');
console.log('[pack-host] 装配完成 → ' + REL);
console.log('[pack-host]   总计        ' + mb(whole.total) + ' / ' + whole.files + ' 个文件');
console.log('[pack-host]   其中 ocr_env ' + mb(runtime.total) + '（离线 OCR 环境预置包，故意随包）');
console.log('[pack-host]   其中 models  ' + mb(models.total) + '（PP-OCRv6 ONNX）');
console.log('[pack-host] 压缩：python scripts/_pack_archive.py "' + REL + '"');
