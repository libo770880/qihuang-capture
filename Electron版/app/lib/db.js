// lib/db.js - SQLite 存储内核（node:sqlite，Electron 44 内嵌 Node 24 自带，零原生依赖）
// 表结构：
//   kv(k,v)                          —— syscfg / ai配置 / ocr配置 等单键 JSON
//   records(id,ts,source,diag,synd,text,data) —— 采集记录（data=全量 JSON，截图 png 仍在 records/ 目录）
//   kb_items(kind,name,data)         —— 知识库行级表（herb/formula/ocrfix/sbf/yibao/unmatched/diag/symptom/westmap）
// 首启自动从旧 JSON 文件迁移（仅目标为空时导入，旧文件改名 .migrated 留底，可回退）。
'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

let db = null;
let dbFile = null;
let log = () => {};

function initDb(userDataDir, logFn) {
  if (db) return api; // 幂等：多模块共用同一连接
  if (typeof logFn === 'function') log = logFn;
  dbFile = path.join(userDataDir, 'data.db');
  db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode=WAL');   // 读写并发安全，断电只丢最后一个事务
  db.exec('PRAGMA synchronous=NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv(
      k TEXT PRIMARY KEY,
      v  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records(
      id     TEXT PRIMARY KEY,
      ts     TEXT,
      source TEXT,
      diag   TEXT,
      synd   TEXT,
      text   TEXT,
      data   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_records_ts ON records(ts DESC);
    CREATE TABLE IF NOT EXISTS kb_items(
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY(kind, name)
    );
    CREATE TABLE IF NOT EXISTS ref_meta(
      kind      TEXT PRIMARY KEY,
      version   TEXT NOT NULL,
      count     INTEGER NOT NULL,
      loaded_at TEXT
    );
    CREATE TABLE IF NOT EXISTS ref_items(
      kind TEXT NOT NULL,
      k1   TEXT NOT NULL,
      k2   TEXT,
      data TEXT NOT NULL,
      PRIMARY KEY(kind, k1)
    );
    CREATE INDEX IF NOT EXISTS idx_ref_k2 ON ref_items(kind, k2);
  `);
  log('[db]', 'opened ' + dbFile);
  return api;
}

// ---------- KV（配置类） ----------
function kvGet(k, fallback = null) {
  const r = db.prepare('SELECT v FROM kv WHERE k=?').get(String(k));
  if (!r) return fallback;
  try { return JSON.parse(r.v); } catch (e) { return fallback; }
}
function kvHas(k) { return !!db.prepare('SELECT 1 FROM kv WHERE k=?').get(String(k)); }
function kvSet(k, v) {
  db.prepare('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v')
    .run(String(k), JSON.stringify(v === undefined ? null : v));
}
function kvDel(k) { db.prepare('DELETE FROM kv WHERE k=?').run(String(k)); }
// 全量读取（配置搬家 / 审计用）：返回 [{k, v}]，v 为已解析对象
function kvAll() {
  return db.prepare('SELECT k,v FROM kv ORDER BY k').all()
    .map(r => { let v = null; try { v = JSON.parse(r.v); } catch (e) { v = null; } return { k: r.k, v }; });
}
// 各知识库类的条目数（配置搬家 / 审计用）
function kbKinds() {
  return db.prepare('SELECT kind, COUNT(*) c FROM kb_items GROUP BY kind ORDER BY kind').all()
    .map(r => ({ kind: r.kind, count: r.c }));
}

// ---------- 知识库行级表 ----------
function kbLoad(kind) {
  return db.prepare('SELECT data FROM kb_items WHERE kind=? ORDER BY rowid').all(String(kind))
    .map(r => { try { return JSON.parse(r.data); } catch (e) { return null; } })
    .filter(Boolean);
}
// 全量重写某类（数组顺序即存储顺序）；单条增删改由调用方在内存数组上完成后整体落库
function kbSave(kind, arr) {
  const items = Array.isArray(arr) ? arr : [];
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM kb_items WHERE kind=?').run(String(kind));
    const ins = db.prepare('INSERT INTO kb_items(kind,name,data) VALUES(?,?,?)');
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const key = String(it.name || it.west || it.w || it.user || it.id || ('#' + (i + 1)));
      ins.run(String(kind), key, JSON.stringify(it));
    }
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch (e2) {} throw e; }
  return items.length;
}
function kbCount(kind) {
  return db.prepare('SELECT COUNT(*) c FROM kb_items WHERE kind=?').get(String(kind)).c;
}

// ---------- 采集记录表 ----------
function recAdd(record) {
  const r = record || {};
  const id = r.id || (cryptoRandomId());
  const item = { ...r, id, ts: r.ts || new Date().toISOString() };
  db.prepare('INSERT OR REPLACE INTO records(id,ts,source,diag,synd,text,data) VALUES(?,?,?,?,?,?,?)')
    .run(id, item.ts || null, item.source || null, item.diag || null, item.synd || null,
      typeof item.text === 'string' ? item.text : null, JSON.stringify(item));
  return item;
}
function recList() {
  return db.prepare('SELECT data FROM records ORDER BY rowid DESC').all()
    .map(r => { try { return JSON.parse(r.data); } catch (e) { return null; } })
    .filter(Boolean);
}
function recGet(id) {
  const r = db.prepare('SELECT data FROM records WHERE id=?').get(String(id));
  if (!r) return null;
  try { return JSON.parse(r.data); } catch (e) { return null; }
}
function recPatch(id, patch) {
  const cur = recGet(id);
  if (!cur) return null;
  const merged = { ...cur, ...patch, id: cur.id }; // id 不许改
  db.prepare('UPDATE records SET ts=?,source=?,diag=?,synd=?,text=?,data=? WHERE id=?')
    .run(merged.ts || null, merged.source || null, merged.diag || null, merged.synd || null,
      typeof merged.text === 'string' ? merged.text : null, JSON.stringify(merged), String(id));
  return merged;
}
function recRemove(id) {
  db.prepare('DELETE FROM records WHERE id=?').run(String(id));
  return true;
}
function recCount() { return db.prepare('SELECT COUNT(*) c FROM records').get().c; }
function cryptoRandomId() {
  try { return require('crypto').randomUUID(); }
  catch (e) { return Date.now() + '_' + Math.random().toString(36).slice(2, 8); }
}

// ---------- 参照库（国标/内置只读数据：GB/T 15657、ICD 对照、内置中药方剂） ----------
// 由 lib/refsync.js 从随应用发布的源文件同步；version 为源文件指纹，应用升级后自动重载。
function refMeta(kind) {
  return db.prepare('SELECT kind,version,count,loaded_at FROM ref_meta WHERE kind=?').get(String(kind)) || null;
}
function refCount(kind) {
  return db.prepare('SELECT COUNT(*) c FROM ref_items WHERE kind=?').get(String(kind)).c;
}
function refLoad(kind) {
  return db.prepare('SELECT data FROM ref_items WHERE kind=? ORDER BY k1').all(String(kind))
    .map(r => { try { return JSON.parse(r.data); } catch (e) { return null; } })
    .filter(Boolean);
}
function refFind(kind, name) {
  return db.prepare('SELECT data FROM ref_items WHERE kind=? AND k2=? LIMIT 50').all(String(kind), String(name))
    .map(r => { try { return JSON.parse(r.data); } catch (e) { return null; } }).filter(Boolean);
}
// 同步：版本一致则跳过；否则事务内整表重写。rows: [{k1,k2,data}]；返回 'unchanged' | 'reloaded'
function refSync(kind, version, rows) {
  const k = String(kind);
  const list = Array.isArray(rows) ? rows : [];
  const meta = refMeta(k);
  if (meta && String(meta.version) === String(version) && meta.count === list.length) return 'unchanged';
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM ref_items WHERE kind=?').run(k);
    const ins = db.prepare('INSERT OR REPLACE INTO ref_items(kind,k1,k2,data) VALUES(?,?,?,?)');
    for (let i = 0; i < list.length; i++) {
      const it = list[i] || {};
      const k1 = String(it.k1 !== undefined && it.k1 !== null ? it.k1 : ('#' + (i + 1)));
      ins.run(k, k1, it.k2 === undefined || it.k2 === null ? null : String(it.k2), JSON.stringify(it.data));
    }
    db.prepare('INSERT INTO ref_meta(kind,version,count,loaded_at) VALUES(?,?,?,?) ON CONFLICT(kind) DO UPDATE SET version=excluded.version,count=excluded.count,loaded_at=excluded.loaded_at')
      .run(k, String(version), list.length, new Date().toISOString());
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch (e2) {} throw e; }
  return 'reloaded';
}
function refInfo() {
  return db.prepare('SELECT kind,version,count,loaded_at FROM ref_meta ORDER BY kind').all()
    .map(r => ({ kind: r.kind, version: r.version, count: r.count, loadedAt: r.loaded_at, actual: refCount(r.kind) }));
}

// ---------- 旧 JSON 一次性迁移 ----------
// 原则：仅当目标表为空且旧文件存在时导入；成功后旧文件改名 .migrated（留底可回退）。
const KB_FILE_KINDS = [
  ['knowledge/herbs.json', 'herb'], ['knowledge/formulas.json', 'formula'],
  ['knowledge/ocrfixes.json', 'ocrfix'], ['knowledge/shibafan.json', 'sbf'],
  ['knowledge/yibao.json', 'yibao'], ['knowledge/unmatched.json', 'unmatched'],
  ['knowledge/diagnoses.json', 'diag'], ['knowledge/symptoms.json', 'symptom'],
  ['knowledge/westmap.json', 'westmap'],
];
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return undefined; }
}
function migrateDone(file) {
  try { fs.renameSync(file, file + '.migrated'); } catch (e) { /* 已存在则保留原文件 */ }
}
function migrateJson(userDataDir) {
  const moved = [];
  // 1) 知识库各表
  for (const [rel, kind] of KB_FILE_KINDS) {
    const f = path.join(userDataDir, rel);
    if (!fs.existsSync(f)) continue;
    if (kbCount(kind) > 0) continue; // 已有数据不覆盖
    const arr = readJson(f);
    if (Array.isArray(arr) && arr.length) {
      kbSave(kind, arr);
      migrateDone(f);
      moved.push(`${rel}→${kind}(${arr.length})`);
    }
  }
  // 2) 采集记录（index.json 为准；散件补充；导入后散件移入 records/_migrated/）
  const recDir = path.join(userDataDir, 'records');
  const idxFile = path.join(recDir, 'index.json');
  if (fs.existsSync(idxFile) && recCount() === 0) {
    const idx = readJson(idxFile);
    const seen = new Set();
    let n = 0;
    if (Array.isArray(idx)) {
      for (let i = idx.length - 1; i >= 0; i--) { // 倒序导入：旧列表最新在前，rowid DESC 才能保持新在前
        const r = idx[i];
        if (r && r.id) { recAdd(r); seen.add(r.id); n++; }
      }
    }
    // 散件记录文件（未被索引收录的也收进来）
    let ents = [];
    try { ents = fs.readdirSync(recDir); } catch (e) {}
    const migDir = path.join(recDir, '_migrated');
    for (const name of ents) {
      if (!name.endsWith('.json') || name === 'index.json') continue;
      const f = path.join(recDir, name);
      const r = readJson(f);
      if (r && r.id && !seen.has(r.id)) { recAdd(r); seen.add(r.id); n++; }
      try {
        fs.mkdirSync(migDir, { recursive: true });
        fs.renameSync(f, path.join(migDir, name));
      } catch (e) { /* 移不走就留着 */ }
    }
    migrateDone(idxFile);
    moved.push(`records/index.json→records(${n})`);
  }
  // 3) 配置类 KV
  const kvMigrations = [
    ['syscfg.json', 'syscfg'], ['ocr.json', 'ocr'], ['config/ai.json', 'ai'],
  ];
  for (const [rel, key] of kvMigrations) {
    const f = path.join(userDataDir, rel);
    if (!fs.existsSync(f) || kvHas(key)) continue;
    const obj = readJson(f);
    if (obj && typeof obj === 'object') {
      kvSet(key, obj);
      migrateDone(f);
      moved.push(`${rel}→kv:${key}`);
    }
  }
  if (moved.length) log('[db]', 'migrated: ' + moved.join(', '));
  return moved;
}

// ---------- 配置快照（搬家 / 审计） ----------
// 导出：kv 全表 + kb_items 全表（预设数据、自建数据、纠错表、补库队列、清理规则都在这里）
function exportConfigRaw() {
  const kv = {};
  for (const it of kvAll()) kv[it.k] = it.v;
  const kb = {};
  for (const it of kbKinds()) kb[it.kind] = kbLoad(it.kind);
  return { kv, kb };
}
// 导入：只覆盖传入的键/类，未提供的保持原样（避免旧包把新版本新增配置抹掉）；
// 事务内完成，任一步失败整体回滚。kb 类以整类替换（与后台编辑语义一致）。
function applyConfig(kvObj, kbMap) {
  const kvList = (kvObj && typeof kvObj === 'object') ? kvObj : {};
  const kbList = (kbMap && typeof kbMap === 'object') ? kbMap : {};
  let kvN = 0, kbN = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    const ins = db.prepare('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v');
    for (const k of Object.keys(kvList)) {
      ins.run(String(k), JSON.stringify(kvList[k] === undefined ? null : kvList[k]));
      kvN++;
    }
    for (const kind of Object.keys(kbList)) {
      const arr = Array.isArray(kbList[kind]) ? kbList[kind] : [];
      db.prepare('DELETE FROM kb_items WHERE kind=?').run(String(kind));
      const ki = db.prepare('INSERT INTO kb_items(kind,name,data) VALUES(?,?,?)');
      for (let i = 0; i < arr.length; i++) {
        const o = arr[i] || {};
        const key = String(o.name || o.west || o.w || o.user || o.id || ('#' + (i + 1)));
        ki.run(String(kind), key, JSON.stringify(o));
        kbN++;
      }
    }
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch (e2) {} throw e; }
  return { kv: kvN, kb: kbN };
}

// ---------- 备份支持 ----------
function checkpoint() {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); return true; } catch (e) { return false; }
}
// 在线备份到目标文件（不中断服务）；失败退化为 checkpoint+拷贝
function backupTo(destFile) {
  try {
    checkpoint();
    fs.copyFileSync(dbFile, destFile);
    return true;
  } catch (e) { return false; }
}

const api = {
  initDb, kvGet, kvSet, kvHas, kvDel, kvAll,
  kbLoad, kbSave, kbCount, kbKinds,
  recAdd, recList, recGet, recPatch, recRemove, recCount,
  refMeta, refCount, refLoad, refFind, refSync, refInfo,
  migrateJson, checkpoint, backupTo, exportConfigRaw, applyConfig,
  get file() { return dbFile; }
};
module.exports = api;
