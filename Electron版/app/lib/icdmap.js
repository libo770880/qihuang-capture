// lib/icdmap.js - 医保编码对照库：国临版（ICD-10 国临床版2.0）↔ 医保版2.0
// 数据源：优先 data.db 的 ref_items(kind='icd')（由 lib/refsync.js 同步）；
//         参照库尚未就绪时回落 data/icd10-map.json（随应用发布）。
// 每条 [glCode, glName, ybCode, ybName]；模块附加 diff 标记与检索。
'use strict';
const DB = require('./db');

let _arr = null;
let _byGlName = null;
let _ver = '';

function dbVersion() {
  try {
    const meta = DB.refMeta('icd');
    return meta && meta.count ? (String(meta.version) + '#' + meta.count) : '';
  } catch (e) { return ''; }
}

function build(rows) {
  _arr = rows.map((r, i) => {
    const glCode = r[0], glName = r[1], ybCode = r[2], ybName = r[3];
    return {
      i, glCode, glName, ybCode, ybName,
      diffCode: glCode !== ybCode,
      diffName: glName !== ybName,
      // 检索串预计算（3.5 万行，避免每次检索重复 toLowerCase）
      hay: [glCode, glName, ybCode, ybName].join(' ').toLowerCase()
    };
  });
  // 名称索引（国临版名称 → 条目，用于按诊断名反查编码）
  _byGlName = new Map();
  for (const x of _arr) if (!_byGlName.has(x.glName)) _byGlName.set(x.glName, x);
}

function ensure() {
  const v = dbVersion();
  if (v) {
    if (_arr && _ver === v) return;              // 命中缓存：仅一次单行查询
    const rows = DB.refLoad('icd');              // 版本变化才整表加载
    if (rows.length) { build(rows); _ver = v; return; }
  }
  if (!_arr) { build(require('../data/icd10-map.json')); _ver = 'json-fallback'; }
}

function stats() {
  ensure();
  const diffCode = _arr.filter(x => x.diffCode).length;
  const diffName = _arr.filter(x => x.diffName).length;
  // 差异样本类目分布（取国临码前3位 A00 形态）
  const catCount = {};
  for (const x of _arr) if (x.diffCode || x.diffName) {
    const c = x.glCode.slice(0, 3);
    catCount[c] = (catCount[c] || 0) + 1;
  }
  return { total: _arr.length, diffCode, diffName, diffCats: catCount,
    source: _ver === 'json-fallback' ? 'json' : 'db' };
}

// q: 关键词（编码/名称，国临版或医保版任一侧命中即返回）
// mode: 'all' 全部 | 'diff' 仅看有差异 | 'same' 仅看完全一致
function search(q, mode = 'all', max = 300) {
  ensure();
  const kw = String(q || '').trim().toLowerCase();
  const out = [];
  for (const x of _arr) {
    if (mode === 'diff' && !(x.diffCode || x.diffName)) continue;
    if (mode === 'same' && (x.diffCode || x.diffName)) continue;
    if (!kw) { out.push(x); if (out.length >= max) break; continue; }
    if (
      x.glCode.toLowerCase().includes(kw) || x.ybCode.toLowerCase().includes(kw) ||
      x.glName.toLowerCase().includes(kw) || x.ybName.toLowerCase().includes(kw)
    ) { out.push(x); if (out.length >= max) break; }
  }
  return { list: out, truncated: out.length >= max };
}

// 按国临版编码精确查询
function lookupByCode(code) {
  ensure();
  const c = String(code || '').trim();
  return _arr.find(x => x.glCode === c || x.ybCode === c) || null;
}

// 按诊断名称查询（国临版名称精确优先，其次包含）
function lookupByName(name) {
  ensure();
  const n = String(name || '').trim();
  if (!n) return null;
  if (_byGlName.has(n)) return _byGlName.get(n);
  for (const x of _arr) if (x.glName === n || x.ybName === n) return x;
  for (const x of _arr) if (x.glName.includes(n) || x.ybName.includes(n)) return x;
  return null;
}

// ---------- 西医诊断名归一（2026-10-19）----------
// 国临版正名 ← 精确 → 医保版名反向 → 唯一包含；西医名短词歧义大（「高血压」命中 100+ 条），
// 包含式一律要求 ≥4 字；匹配不到或候选并列时原样返回（宁缺勿错）。
// 与 Domain/IcdMap.cs NormalizeName 逐字同源（对拍 chan_diag_norm）。
let _nameSet = null;
function glNames() {
  ensure();
  if (!_nameSet) _nameSet = [...new Set(_arr.map(x => x.glName))];
  return _nameSet;
}
function normalizeName(name) {
  ensure();
  const t = String(name || '').trim();
  if (!t) return t;
  if (_byGlName.has(t)) return t;
  const yb = _arr.find(x => x.ybName === t);
  if (yb) return yb.glName;
  const all = glNames();
  // 包含式①：国临名 ⊂ token（token 更长）→ 唯一最长命中
  const sup = all.filter(n => n.length >= 4 && n.length < t.length && t.includes(n));
  if (sup.length) {
    const maxL = Math.max(...sup.map(n => n.length));
    const top = sup.filter(n => n.length === maxL);
    if (top.length === 1) return top[0];
  }
  // 包含式②：token ⊂ 国临名（缩写 ≥4 字）→ 唯一最短命中
  if (t.length >= 4) {
    const sub = all.filter(n => n.length > t.length && n.includes(t));
    if (sub.length) {
      const minL = Math.min(...sub.map(n => n.length));
      const top = sub.filter(n => n.length === minL);
      if (top.length === 1) return top[0];
    }
  }
  return t;
}

module.exports = {
  stats, search, lookupByCode, lookupByName, normalizeName,
  get count() { ensure(); return _arr.length; },
  source: () => (_ver === 'json-fallback' ? 'json' : 'db')
};
