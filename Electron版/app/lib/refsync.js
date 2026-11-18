// lib/refsync.js - 参照库同步：把随应用发布的只读国标/内置数据同步进 data.db
//   gbt       GB/T 15657-2021《中医病证分类与代码》病名/证候/治法（data/gbt-15657.json）
//   icd       ICD-10 国临版 ↔ 医保版2.0 编码对照（data/icd10-map.json）
//   kb-herb   内置中药（lib/kb.js + kb-herbs-*.js）
//   kb-formula 内置方剂（lib/kb.js + kb-formulas-*.js）
// 版本号 = 源文件指纹（大小+修改时间）；应用升级换了源文件即自动重载，无需手工干预。
'use strict';
const fs = require('fs');
const path = require('path');
const DB = require('./db');

const ROOT = path.join(__dirname, '..');
const KB_SRC_FILES = ['lib/kb.js', 'lib/kb-extra.js', 'lib/kborig.js', 'lib/herbcat.js',
  'lib/kb-herbs-a.js', 'lib/kb-herbs-b.js', 'lib/kb-herbs-c.js', 'lib/kb-herbs-d.js',
  'lib/kb-herbs-e.js', 'lib/kb-herbs-f.js', 'lib/kb-herbs-g.js', 'lib/kb-herbs-h.js',
  'lib/kb-formulas-a.js', 'lib/kb-formulas-b.js', 'lib/kb-formulas-c.js', 'lib/kb-formulas-d.js',
  'lib/kb-formulas-e.js', 'lib/kb-formulas-f.js'];

// 源文件指纹：文件名+大小+修改时间（改文件即变，跨机一致无需读全文）
function stamp(relFiles) {
  const parts = [];
  for (const rel of relFiles) {
    try {
      const st = fs.statSync(path.join(ROOT, rel));
      parts.push(rel + ':' + st.size + ':' + Math.round(st.mtimeMs));
    } catch (e) { parts.push(rel + ':missing'); }
  }
  return require('crypto').createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}
function readJson(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch (e) { return null; }
}

// ---------- 各参照库构建 ----------
function buildGbt() {
  const raw = readJson('data/gbt-15657.json');
  if (!raw) return null;
  const rows = [];
  for (const kind of ['disease', 'syndrome', 'therapy']) {
    for (const x of (raw[kind] || [])) {
      const code = String(x.code || '');
      if (!code) continue;
      rows.push({
        // k1 带 seq：GB/T 库内存在同一编码多次出现（细分类目复用父级码），不带 seq 会被主键去重吃掉
        k1: kind + ':' + code + ':' + (x.seq === undefined ? rows.length : x.seq), k2: x.name,
        data: { seq: x.seq, code, name: x.name, kind, aliases: x.aliases || [] }
      });
    }
  }
  return { version: 'gbt15657-' + stamp(['data/gbt-15657.json']), rows };
}

function buildIcd() {
  const raw = readJson('data/icd10-map.json');
  if (!Array.isArray(raw)) return null;
  const rows = raw.map((r, i) => ({ k1: 'r' + i, k2: r && r[1] || '', data: r }));
  return { version: 'icd10map-' + stamp(['data/icd10-map.json']), rows };
}

function buildKb() {
  let KB;
  try { KB = require('./kb'); } catch (e) { return null; }
  if (typeof KB.getBuiltinHerbs !== 'function' || typeof KB.getBuiltinFormulas !== 'function') return null;
  const herbs = KB.getBuiltinHerbs().map(h => ({ k1: h.n, k2: h.n, data: h }));
  const formulas = KB.getBuiltinFormulas().map(f => ({ k1: f.n, k2: f.n, data: f }));
  return { version: 'kb-' + stamp(KB_SRC_FILES), herbs, formulas };
}

// ---------- 同步入口 ----------
function syncAll(log) {
  const out = [];
  const logFn = typeof log === 'function' ? log : () => {};
  try {
    const gbt = buildGbt();
    if (gbt) out.push('gbt:' + DB.refSync('gbt', gbt.version, gbt.rows) + '(' + gbt.rows.length + ')');
  } catch (e) { out.push('gbt:ERR ' + (e && e.message)); }
  try {
    const icd = buildIcd();
    if (icd) out.push('icd:' + DB.refSync('icd', icd.version, icd.rows) + '(' + icd.rows.length + ')');
  } catch (e) { out.push('icd:ERR ' + (e && e.message)); }
  try {
    const kb = buildKb();
    if (kb) {
      out.push('kb-herb:' + DB.refSync('kb-herb', kb.version, kb.herbs) + '(' + kb.herbs.length + ')');
      out.push('kb-formula:' + DB.refSync('kb-formula', kb.version, kb.formulas) + '(' + kb.formulas.length + ')');
    }
  } catch (e) { out.push('kb:ERR ' + (e && e.message)); }
  const changed = out.filter(s => s.includes(':reloaded') || s.includes('ERR'));
  logFn('[ref]', 'refs: ' + out.join(', ') + (changed.length ? ' | 已更新' : ' | 均为最新'));
  return out;
}

module.exports = { syncAll, refInfo: DB.refInfo };
