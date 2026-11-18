// 装配完整发布目录：release/岐黄鉴方采集助手-完整版/
//   使用说明.txt
//   Electron版/  ← release/岐黄鉴方采集助手/
//   NET宿主版/   ← release/岐黄鉴方采集助手-net/
//
// 前置：已分别跑过
//   node scripts/_pack_release.js     （Electron 版）
//   node scripts/_pack_host.js        （.NET 宿主版，需先 dotnet publish）
// 用法：node scripts/_pack_full.js [YYYY-MM-DD]
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const REL = path.join(ROOT, 'release');
const SRC_WEB = path.join(REL, '岐黄鉴方采集助手');
const SRC_NET = path.join(REL, '岐黄鉴方采集助手-net');
const OUT = path.join(REL, '岐黄鉴方采集助手-完整版');

const day = process.argv[2] || new Date().toISOString().slice(0, 10);

function assertDir(p, how) {
  if (!fs.existsSync(p)) {
    console.error(`[pack-full] 缺少 ${p}\n            先跑：${how}`);
    process.exit(1);
  }
}

function copyDir(src, dst, filter) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name), d = path.join(dst, name);
    if (filter && !filter(s)) continue;
    if (fs.statSync(s).isDirectory()) copyDir(s, d, filter);
    else fs.copyFileSync(s, d);
  }
}

function dirSize(dir) {
  let total = 0, files = 0;
  const walk = (p) => {
    for (const n of fs.readdirSync(p)) {
      const f = path.join(p, n), st = fs.statSync(f);
      if (st.isDirectory()) walk(f);
      else { total += st.size; files++; }
    }
  };
  walk(dir);
  return { total, files };
}

assertDir(SRC_WEB, 'node scripts/_pack_release.js');
assertDir(SRC_NET, 'node scripts/_pack_host.js');
for (const need of ['QhjfCapture.exe']) {
  if (!fs.existsSync(path.join(SRC_NET, 'app', need))) {
    console.error(`[pack-full] ${path.join(SRC_NET, 'app', need)} 不存在，宿主包不完整`);
    process.exit(1);
  }
}
for (const need of [path.join('app', 'main.js'), path.join('runtime', 'electron.exe')]) {
  if (!fs.existsSync(path.join(SRC_WEB, need))) {
    console.error(`[pack-full] ${path.join(SRC_WEB, need)} 不存在，Electron 包不完整`);
    process.exit(1);
  }
}

console.log('[pack-full] 清理旧产物...');
// 保护完整版内各版本的便携数据：用户可能直接在这两个目录里运行，
// app\userdata 里是真实记录/配置/知识库，重建时先挪出、装配后还原。
// 上一版只做了「挪出 + 还原」，一旦还原抛错（WebView2 文件被占用等）就会把数据留在
// .tmp-*-userdata-* 里、而输出目录变成空壳 —— 下面加了中断恢复与降级还原。
const keeps = {};
const guard = require('./lib/packguard');
const leftoversOf = (v) => {
  try {
    return fs.readdirSync(ROOT).filter(n => n.startsWith(`.tmp-${v}-userdata-`))
      .map(n => { const p = path.join(ROOT, n); let t = 0; try { t = fs.statSync(p).mtimeMs; } catch (e) {} return { p, t }; })
      .filter(x => { try { return fs.statSync(x.p).isDirectory(); } catch (e) { return false; } })
      .sort((a, b) => b.t - a.t);
  } catch (e) { return []; }
};
for (const v of ['Electron版', 'NET宿主版']) {
  const ud = path.join(OUT, v, 'app', 'userdata');
  // 0) 上次装配中断：数据还在 .tmp 里、目标目录是空壳 → 先恢复
  const lefts = leftoversOf(v);
  if (!fs.existsSync(path.join(ud, 'data.db')) && lefts.length) {
    try {
      if (fs.existsSync(ud)) guard.rmrf(ud);
      fs.renameSync(lefts[0].p, ud);
      console.log(`[pack-full] 已从上次中断的临时目录恢复 ${v} 便携数据`);
    } catch (e) { console.warn('[pack-full] 恢复中断数据失败：' + e.message); }
  }
  // 1) 占用检查：两个版本目录都在 OUT 下，任一程序在跑都会锁住 data.db / exe
  guard.assertNoRunning(OUT, { force: process.argv.includes('--force-close') });
}
// 清理：逐项删除，但原地保留两个版本的 app\userdata（不 rename、不碰 data.db）
if (fs.existsSync(OUT)) {
  const r = guard.cleanKeep(OUT, [
    path.join('Electron版', 'app', 'userdata'),
    path.join('NET宿主版', 'app', 'userdata'),
  ]);
  console.log('[pack-full] 已清理 ' + r.removed + ' 项（两版 app\\userdata 原地保留）');
}
fs.mkdirSync(OUT, { recursive: true });

console.log('[pack-full] 装配 Electron版 / NET宿主版...');
// 不搬运源包里的真实用户数据（app\userdata 可能已落库），只带 .portable 标记生成空目录
const noUserData = (p) => !/[\\/]app[\\/]userdata([\\/]|$)/.test(p);
copyDir(SRC_WEB, path.join(OUT, 'Electron版'), noUserData);
copyDir(SRC_NET, path.join(OUT, 'NET宿主版'), noUserData);
for (const v of ['Electron版', 'NET宿主版']) {
  const ud = path.join(OUT, v, 'app', 'userdata');
  fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(ud, '.portable'), '数据随包存放；删除本文件则回到 %APPDATA% 模式\r\n', 'utf8');
}

fs.writeFileSync(path.join(OUT, '使用说明.txt'), `岐黄鉴方 · 中医智能辨证质控与安全审方系统
完整发布包 · ${day}

============================================================
一、包内结构
============================================================
  使用说明.txt        本文件
  Electron版\\         标准发布版（Electron 运行时，兼容性最好）
  NET宿主版\\          .NET 8 WPF + WebView2 宿主版（启动快、内存占用低）

两个版本功能一致、数据互通，任选其一使用即可，请勿同时运行。

============================================================
二、启动方式
============================================================
  Electron版：双击  Electron版\\启动岐黄鉴方.vbs
  NET宿主版：双击  NET宿主版\\启动 岐黄鉴方采集助手.vbs

  · 启动后出现悬浮球，拖到不遮挡的位置即可
  · 退出：右键悬浮球 → 退出
  · 重复双击安全：程序自带单实例锁，二次启动只会唤出已有界面
  · 热键 Ctrl+Alt+V：在医院系统复制病历/医嘱后一键采集

============================================================
三、系统要求
============================================================
  操作系统  Windows 10 1809 及以上 / Windows 11，64 位
  内存      4 GB 以上（建议 8 GB）
  分辨率    1366×768 及以上

  Electron版：自带 Chromium，无需安装任何运行库
  NET宿主版：自带 .NET 8 运行时；需要 WebView2 Runtime
             （Windows 11 与新版 Windows 10 已内置，
               缺失时安装微软 "Microsoft Edge WebView2 Runtime" 即可）

  文字识别（OCR）：首次使用时按界面提示一键安装离线识别环境，
  安装包已随发布包分发，全程无需联网。

============================================================
四、数据位置与备份（搬家不丢配置）
============================================================
  数据目录：<版本目录>\\app\\userdata\\（随包存放，便携模式）
  全部设置都在一个文件里：data.db
  （后台设置 / 账号科室 / AI 模型 / AI 补库队列 / 文字纠错 / 预设库 /
    清理规则 / 点评红线 / 采集记录——逐项可在「系统设置 → 数据搬家」查看）

  · 搬家：拷 app\\userdata\\data.db 一个文件到新机器同一位置即可（约 10MB）
    截图与备份另存 app\\userdata\\records、backups，需要历史图片时一并拷走
  · 运行缓存（WebView2 / Local Storage）已外置到
    %LOCALAPPDATA%\\岐黄鉴方采集助手-缓存\\，不占数据目录、不随包搬家
  · 升级：打包脚本重建目录时会自动保留 app\\userdata，不会被清掉
  · 首启迁移：若 app\\userdata 内没有 data.db，程序会自动从旧的
    %APPDATA%\\岐黄鉴方·悬浮采集助手\\ 复制配置、记录与知识库（旧目录保持不动）
  · 回到系统目录模式：删除 app\\userdata\\.portable 后重启
  · 两版共用数据：把其中一个 app\\userdata\\data.db 复制到另一个的 app\\userdata\\（先退出程序）
  · 卸载：删除本发布目录即可（数据就在目录内）

============================================================
五、数据安全
============================================================
  · 全部数据本地存储，不上传云端
  · 采集文本入库前已做患者信息脱敏（姓名/住院号/身份证等）
  · 支持完全离线运行：不配置 AI 接口时，辨证与审方全部走本地规则引擎
  · 可选接入内网部署的开源大模型（如华佗 GPT 等），数据不出院内网
`, 'utf8');

const w = dirSize(path.join(OUT, 'Electron版'));
const n = dirSize(path.join(OUT, 'NET宿主版'));
const mb = (b) => (b / 1048576).toFixed(0) + ' MB';
console.log(`[pack-full] 完成：Electron版 ${mb(w.total)} (${w.files} 文件) | NET宿主版 ${mb(n.total)} (${n.files} 文件)`);
console.log(`[pack-full] 输出：${OUT}`);
