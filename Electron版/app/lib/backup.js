// 数据备份/恢复：把 data.db（SQLite，含记录/知识库/全部配置）+ records/ 截图 png
// 打成单文件备份包（JSON + base64，纯 Node 无第三方依赖，跨机器无 zip 中文编码坑）。
// 恢复前自动把当前数据快照到 backups/pre-import-*，防误导入把现有数据冲掉。
// 旧版 v1 备份包（纯 JSON 文件）仍可导入：恢复后自动把当前 data.db 改名留底，下次启动自动从 JSON 重新迁入。
'use strict';
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const DB = require('./db');

const USER_ROOT = () => {
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') return app.getPath('userData');
  } catch (e) { /* 非 Electron 进程（对拍探针/脚本）走下面的回退 */ }
  // 回退：与 .NET 宿主 AppPaths.UserData 同规则（%APPDATA%\岐黄鉴方·悬浮采集助手）
  return path.join(process.env.APPDATA || process.env.HOME || '.', '岐黄鉴方·悬浮采集助手');
};
const BACKUP_DIRS = ['records', 'knowledge', 'config'];
const ROOT_FILES = ['data.db', 'syscfg.json', 'ocr.json']; // 后两个为 v1 兼容收集
const APP_TAG = 'qihuang-capture-backup';

function walk(dir, base, out) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const ent of ents) {
    const full = path.join(dir, ent.name);
    const rel = path.posix.join(base, ent.name);
    if (ent.isDirectory()) { if (ent.name !== '_migrated') walk(full, rel, out); }
    else if (ent.isFile()) {
      if (ent.name.endsWith('.migrated') || ent.name.endsWith('.json') && base === 'records') continue; // 跳过迁移留底/散件（图片仍收）
      let size = 0;
      try { size = fs.statSync(full).size; } catch (e) {}
      out.push({ abs: full, rel, size });
    }
  }
  return out;
}

function collectFiles() {
  const root = USER_ROOT();
  const files = [];
  try { DB.checkpoint(); } catch (e) {}
  for (const d of BACKUP_DIRS) walk(path.join(root, d), d, files);
  for (const f of ROOT_FILES) {
    const full = path.join(root, f);
    if (fs.existsSync(full)) files.push({ abs: full, rel: f, size: fs.statSync(full).size });
  }
  return files;
}

function buildBundle() {
  const files = collectFiles().map(f => ({
    p: f.rel,
    d: fs.readFileSync(f.abs).toString('base64'),
  }));
  return { app: APP_TAG, v: 1, ts: new Date().toISOString(), count: files.length, files };
}

// 安全防护：只允许恢复白名单目录/文件，拒绝任何路径穿越
function safeRel(p) {
  const rel = String(p || '').replace(/\\/g, '/');
  if (rel.includes('..') || path.isAbsolute(rel)) return null;
  const top = rel.split('/')[0];
  if (BACKUP_DIRS.includes(top) || ROOT_FILES.includes(rel)) return rel;
  return null;
}

function listAutoBackups() {
  const dir = path.join(USER_ROOT(), 'backups');
  try { return fs.readdirSync(dir).filter(f => f.startsWith('auto-') && f.endsWith('.bak.json')).sort().reverse(); }
  catch (e) { return []; }
}

// 导出：写临时文件再原子改名，防半截文件
function exportBackup(outPath) {
  const bundle = buildBundle();
  const tmp = outPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(bundle));
  fs.renameSync(tmp, outPath);
  return { ok: true, path: outPath, count: bundle.count, bytes: fs.statSync(outPath).size, ts: bundle.ts };
}

// 恢复：先快照当前数据到 backups/pre-import-<ts>，再逐文件还原（只落白名单路径）
function importBackup(inPath) {
  const root = USER_ROOT();
  const bundle = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  if (!bundle || bundle.app !== APP_TAG || !Array.isArray(bundle.files)) {
    throw new Error('不是本应用的备份文件（或已损坏）');
  }
  const hasDb = bundle.files.some(f => safeRel(f.p) === 'data.db');
  // 1) 恢复前快照
  const snapDir = path.join(root, 'backups', 'pre-import-' + Date.now());
  fs.mkdirSync(snapDir, { recursive: true });
  for (const f of collectFiles()) {
    const dest = path.join(snapDir, f.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f.abs, dest);
  }
  // 2) 旧版 v1 包（无 data.db）：把当前 data.db 改名留底，下次启动 migrateJson 自动从恢复出的 JSON 重建
  if (!hasDb && fs.existsSync(path.join(root, 'data.db'))) {
    try { DB.checkpoint(); } catch (e) {}
    fs.renameSync(path.join(root, 'data.db'), path.join(root, 'data.db.pre-restore-' + Date.now()));
    for (const suf of ['-wal', '-shm']) { try { fs.unlinkSync(path.join(root, 'data.db' + suf)); } catch (e) {} }
  }
  // 3) 还原
  let restored = 0, skipped = 0;
  for (const it of bundle.files) {
    const rel = safeRel(it.p);
    if (!rel) { skipped++; continue; }
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(String(it.d || ''), 'base64'));
    restored++;
  }
  // 4) 恢复了 data.db：清掉残留 wal/shm（属于旧库的脏数据）
  if (hasDb) {
    for (const suf of ['-wal', '-shm']) { try { fs.unlinkSync(path.join(root, 'data.db' + suf)); } catch (e) {} }
  }
  return { ok: true, restored, skipped, snapshot: snapDir, ts: bundle.ts || '', needRestart: true };
}

// ---------- 程序目录镜像备份（换机防丢） ----------
// 换电脑/重装系统时 userData（%APPDATA%）连同里面的自动备份一起没了，光靠「自动日备」
// 救不回手工维护的 AI Key / 纠错 / 剔除规则。所以在**程序目录**下再镜像一份：
// 用户把整个程序文件夹拷到新机器（或网盘同步），数据就跟着走。
const MIRROR_KEEP = 3;   // 镜像目录只留最近几份，避免程序目录无限膨胀
function appRootDir() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getAppPath === 'function') {
      // 打包态：exe 同级目录（发布目录 app/）
      if (app.isPackaged) return path.dirname(app.getPath('exe'));
      // 开发态：app.getAppPath() 随启动方式漂移（electron . → 项目根；electron scripts/x.js → scripts/），
      // 统一按「含 renderer/」认定应用根，与 .NET 宿主 AppPaths.Root 同规则
      const p = app.getAppPath();
      if (p && fs.existsSync(path.join(p, 'renderer'))) return p;
    }
  } catch (e) { /* 非 Electron 进程（对拍探针/脚本）走下面的回退 */ }
  // 回退：按本文件位置向上找含 renderer/ 的目录 —— 与 .NET 宿主 AppPaths.Root 同规则，
  // 保证两侧算出的镜像目录一致（对拍可比对）
  try {
    let d = path.dirname(__dirname);
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(d, 'renderer'))) return d;
      const p = path.dirname(d);
      if (p === d) break;
      d = p;
    }
  } catch (e) {}
  return null;
}
function mirrorDir() {
  const root = appRootDir();
  if (!root) return null;
  const md = path.join(root, 'backups');
  const ud = path.resolve(USER_ROOT());
  const pm = path.resolve(md);
  // 便携模式下数据目录可能就在程序目录里 —— 那已经跟着走了，无需再镜像
  if (pm === ud || pm.startsWith(ud + path.sep)) return null;
  return md;
}
function writable(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); return true; }
  catch (e) { return false; }
}
function listMirrorFiles(dir) {
  try {
    return fs.readdirSync(dir).filter(f => f.startsWith('auto-') && f.endsWith('.bak.json'))
      .map(f => { let sz = 0, mt = 0; try { const st = fs.statSync(path.join(dir, f)); sz = st.size; mt = st.mtimeMs; } catch (e) {} return { name: f, bytes: sz, ts: mt }; })
      .sort((a, b) => b.ts - a.ts);
  } catch (e) { return []; }
}
/** 把一份已生成的备份复制进程序目录镜像（保留最近 MIRROR_KEEP 份） */
function mirrorCopy(srcPath) {
  const md = mirrorDir();
  if (!md || !srcPath || !fs.existsSync(srcPath)) return null;
  if (!writable(md)) return null;           // 装在 Program Files 等只读位置 → 静默跳过
  try {
    const dest = path.join(md, path.basename(srcPath));
    fs.copyFileSync(srcPath, dest + '.tmp');
    fs.renameSync(dest + '.tmp', dest);
    const olds = listMirrorFiles(md).slice(MIRROR_KEEP);
    for (const f of olds) { try { fs.unlinkSync(path.join(md, f.name)); } catch (e) {} }
    return dest;
  } catch (e) { return null; }
}
/** 镜像目录状态（后台「备份」页展示；只读，不产生写） */
function mirrorInfo() {
  const md = mirrorDir();
  if (!md) return { ok: false, reason: 'no-mirror-dir' };
  const files = listMirrorFiles(md);
  return {
    ok: true, dir: md, writable: writable(md), count: files.length,
    bytes: files.reduce((a, f) => a + f.bytes, 0),
    latest: files.length ? new Date(files[0].ts).toISOString() : '',
  };
}
/** 立即做一份并镜像（后台「立即备份并镜像」按钮） */
function mirrorNow() {
  const md = mirrorDir();
  if (!md) return { ok: false, error: '当前环境无需镜像（数据目录已在程序目录内）' };
  if (!writable(md)) return { ok: false, error: '程序目录不可写：' + md };
  const dir = path.join(USER_ROOT(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const name = 'auto-' + new Date().toISOString().slice(0, 10) + '-' + Date.now() + '.bak.json';
  const out = path.join(dir, name);
  fs.writeFileSync(out + '.tmp', JSON.stringify(buildBundle()));
  fs.renameSync(out + '.tmp', out);
  const dest = mirrorCopy(out);
  return { ok: !!dest, path: dest || '', src: out, count: listMirrorFiles(md).length };
}

// 自动日备：启动时调用，当天已有备份则跳过；保留最近 7 份
function autoBackupDaily() {
  try {
    const existing = listAutoBackups();
    const today = new Date().toISOString().slice(0, 10);
    if (existing.some(f => f.includes(today))) return null;
    const name = 'auto-' + today + '-' + Date.now() + '.bak.json';
    const dir = path.join(USER_ROOT(), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, name);
    fs.writeFileSync(out + '.tmp', JSON.stringify(buildBundle()));
    fs.renameSync(out + '.tmp', out);
    // 清理：仅删 auto-* 且只保留最新 7 个（pre-import-* 手动快照不清理）
    const olds = listAutoBackups().slice(7);
    for (const f of olds) { try { fs.unlinkSync(path.join(dir, f)); } catch (e) {} }
    try { mirrorCopy(out); } catch (e) {} // 顺手镜像一份到程序目录（换机防丢）
    return out;
  } catch (e) {
    return null; // 自动备份失败不阻断启动
  }
}

module.exports = { exportBackup, importBackup, autoBackupDaily, listAutoBackups, APP_TAG,
                   mirrorInfo, mirrorNow, mirrorCopy };
