// lib/dataport.js - 配置搬家内核：把「后台设置 / AI 模型 / AI 补库 / 文字纠错 / 预设数据 / 清理规则」
// 全部收敛到 data.db 一个文件，并提供审计、单文件导出与导入。
//
// 设计原则（与 .NET 宿主 Domain/DataPort.cs 同源）：
//   1. data.db 是唯一配置源：kv（syscfg/ai/ocr/rxrule/uiprefs…）+ kb_items（预设/自建/纠错/补库队列）
//      + ref_items（国标/ICD/内置方药，随程序重建，不进搬家包）。
//   2. 搬家 = 关闭软件后拷 data.db 一个文件；跨机装好后放回 app\userdata\ 即恢复全部设置。
//   3. 配置包（.qhcfg）= kv + kb_items 的 JSON 快照，可在已装好的机器上合并导入（不动记录与截图）。
//   4. 旧的 JSON 文件（syscfg.json / config/ai.json / knowledge/*.json）只作迁移留底，不再读写。
'use strict';
const fs = require('fs');
const path = require('path');
const DB = require('./db');

const APP_TAG = 'qihuang-config-bundle';
const VER = 2;

// kv 配置分组：后台可见名称 + 是否必填（必填缺失 = 该机器从未配置过，不算丢）
const KV_GROUPS = [
  { key: 'syscfg', label: '基础信息 · 账号 · 科室 · 登录模式', must: true },
  { key: 'ai', label: 'AI 模型设置 · 清理规则', must: true },
  { key: 'ocr', label: 'OCR 引擎设置', must: true },
  { key: 'rxrule', label: '点评红线阈值', must: true },
  { key: 'uiprefs', label: '界面偏好（主题 / 侧栏 / 导航）', must: false },
  { key: 'ocrTierV2', label: 'OCR 性能档位迁移标记', must: false }
];

// kb_items 知识库分组（内置预设 + 用户自建 + 运行期队列，全部在库）
// 说明：herb/formula/sbf 的内置部分在 ref_items（随程序重建），kb_items 只存自建/覆盖条目，
// 因此这三类允许为 0 条，不算「配置缺失」。
const KB_GROUPS = [
  { kind: 'herb', label: '中药库 · 自建条目（内置 385 见参照库）', must: false },
  { kind: 'formula', label: '方剂库 · 自建条目（内置 322 见参照库）', must: false },
  { kind: 'ocrfix', label: '文字纠错表', must: true },
  { kind: 'sbf', label: '配伍禁忌 · 自建规则（内置 12 条随程序）', must: false },
  { kind: 'yibao', label: '中药医保规则库', must: true },
  { kind: 'unmatched', label: 'AI 补库队列', must: false },
  { kind: 'diag', label: '诊断证型库', must: true },
  { kind: 'symptom', label: '症状库', must: true },
  { kind: 'westmap', label: '西医诊断对照库', must: true }
];

// 仍在文件里的旧配置（正常应为空；非空说明有模块绕过入库直接写文件，属回归）
const LEGACY_FILES = [
  'syscfg.json', 'ocr.json', 'config/ai.json',
  'knowledge/herbs.json', 'knowledge/formulas.json', 'knowledge/ocrfixes.json',
  'knowledge/shibafan.json', 'knowledge/yibao.json', 'knowledge/unmatched.json',
  'knowledge/diagnoses.json', 'knowledge/symptoms.json', 'knowledge/westmap.json'
];

function bytesOf(v) {
  try { return Buffer.byteLength(JSON.stringify(v === undefined ? null : v), 'utf8'); } catch (e) { return 0; }
}
function statBytes(p) { try { return fs.statSync(p).size; } catch (e) { return 0; } }

/**
 * 配置入库审计：告诉用户「哪些设置在库里、哪些还在文件里、data.db 多大」。
 * @param {string} userDataDir 数据目录（data.db 所在）
 */
function audit(userDataDir) {
  const kvRows = DB.kvAll();
  const kvMap = new Map(kvRows.map(r => [r.k, r.v]));
  const kbCounts = new Map(DB.kbKinds().map(r => [r.kind, r.count]));
  const refs = DB.refInfo().map(r => ({ kind: r.kind, count: r.actual, version: r.version }));

  const kvList = KV_GROUPS.map(g => {
    const has = kvMap.has(g.key);
    const v = kvMap.get(g.key);
    return {
      key: g.key, label: g.label, must: !!g.must, present: has,
      bytes: bytesOf(v), keys: (v && typeof v === 'object' && !Array.isArray(v)) ? Object.keys(v).length : 0
    };
  });
  // 未登记但实际存在的键也列出来（避免新增配置漏统计）
  const known = new Set(KV_GROUPS.map(g => g.key));
  for (const r of kvRows) {
    if (known.has(r.k)) continue;
    kvList.push({ key: r.k, label: r.k, must: false, present: true, bytes: bytesOf(r.v), keys: 0, extra: true });
  }

  const kbList = KB_GROUPS.map(g => ({
    kind: g.kind, label: g.label, must: !!g.must,
    present: kbCounts.has(g.kind), count: kbCounts.get(g.kind) || 0
  }));
  const knownKb = new Set(KB_GROUPS.map(g => g.kind));
  for (const r of DB.kbKinds()) {
    if (knownKb.has(r.kind)) continue;
    kbList.push({ kind: r.kind, label: r.kind, must: false, present: true, count: r.count, extra: true });
  }

  const legacy = [];
  for (const rel of LEGACY_FILES) {
    const f = path.join(userDataDir, rel);
    if (fs.existsSync(f)) legacy.push({ rel, bytes: statBytes(f) });
  }

  const dbFile = path.join(userDataDir, 'data.db');
  const dbBytes = statBytes(dbFile);
  const walBytes = statBytes(dbFile + '-wal');
  const recs = DB.recCount();
  // 记录附件（截图）仍在 records/：不参与「配置」搬家，但要如实告诉用户
  let shotCount = 0, shotBytes = 0;
  try {
    const dir = path.join(userDataDir, 'records');
    for (const name of fs.readdirSync(dir)) {
      if (!/\.(png|jpg|jpeg|webp)$/i.test(name)) continue;
      shotCount++;
      shotBytes += statBytes(path.join(dir, name));
    }
  } catch (e) { /* 目录不存在属正常 */ }

  const missingMust = kvList.filter(x => x.must && !x.present).map(x => x.label)
    .concat(kbList.filter(x => x.must && !x.count).map(x => x.label));

  return {
    ok: true,
    dir: userDataDir,
    dbFile,
    dbBytes,
    walBytes,
    totalBytes: dbBytes + walBytes,
    records: recs,
    kv: kvList,
    kb: kbList,
    refs,
    legacy,
    shots: { count: shotCount, bytes: shotBytes },
    // 全部设置都在库里，且没有被绕过的旧文件
    allInDb: legacy.length === 0,
    missingMust,
    groups: { kv: kvList.length, kb: kbList.length, refs: refs.length }
  };
}

/** 导出配置包（.qhcfg）：kv + kb_items，不含记录与截图 */
function exportConfig(destPath) {
  const raw = DB.exportConfigRaw();
  const bundle = {
    app: APP_TAG, v: VER, ts: new Date().toISOString(),
    kv: raw.kv, kb: raw.kb,
    meta: {
      kvKeys: Object.keys(raw.kv).length,
      kbKinds: Object.keys(raw.kb).length,
      kbItems: Object.keys(raw.kb).reduce((n, k) => n + (raw.kb[k] || []).length, 0)
    }
  };
  const tmp = destPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(bundle));
  fs.renameSync(tmp, destPath);
  return {
    ok: true, path: destPath, bytes: statBytes(destPath), ts: bundle.ts,
    kv: bundle.meta.kvKeys, kbKinds: bundle.meta.kbKinds, kbItems: bundle.meta.kbItems
  };
}

/**
 * 导入配置包：只覆盖包内出现的键 / 类，未出现的保持原样。
 * 导入前把当前配置快照到 backups/pre-config-<ts>.qhcfg，可回退。
 */
function importConfig(srcPath) {
  let bundle = null;
  try { bundle = JSON.parse(fs.readFileSync(srcPath, 'utf8')); }
  catch (e) { return { ok: false, error: '文件无法解析：' + (e && e.message || e) }; }
  if (!bundle || bundle.app !== APP_TAG || !bundle.kv || typeof bundle.kv !== 'object') {
    return { ok: false, error: '不是本软件的配置包（或已损坏）' };
  }
  // 版本只做提示，不硬拦：v1 只有 kv，遇到就当纯 kv 包导入
  const kv = bundle.kv || {};
  const kb = (bundle.kb && typeof bundle.kb === 'object') ? bundle.kb : {};

  // 1) 快照当前配置（只快照配置，体积小）
  let snapshot = '';
  try {
    const raw = DB.exportConfigRaw();
    const dir = path.join(path.dirname(DB.file), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    snapshot = path.join(dir, 'pre-config-' + Date.now() + '.qhcfg');
    fs.writeFileSync(snapshot, JSON.stringify({ app: APP_TAG, v: VER, ts: new Date().toISOString(), kv: raw.kv, kb: raw.kb }));
  } catch (e) { snapshot = ''; }

  // 2) 写库（事务）
  let stat = null;
  try { stat = DB.applyConfig(kv, kb); }
  catch (e) { return { ok: false, error: '写入失败：' + (e && e.message || e) }; }

  return {
    ok: true, kv: stat.kv, kb: stat.kb, snapshot,
    from: srcPath, ts: bundle.ts || '', needRestart: false,
    kbKinds: Object.keys(kb).length
  };
}

/** 导出整库：单文件搬家（关闭软件后覆盖到新机器 app\userdata\data.db 即完整恢复） */
function exportDb(destPath) {
  try { DB.checkpoint(); } catch (e) { /* WAL 合并失败也继续，下面按文件拷贝 */ }
  fs.copyFileSync(DB.file, destPath);
  return { ok: true, path: destPath, bytes: statBytes(destPath) };
}

module.exports = {
  audit, exportConfig, importConfig, exportDb,
  KV_GROUPS, KB_GROUPS, LEGACY_FILES, APP_TAG, VER
};
