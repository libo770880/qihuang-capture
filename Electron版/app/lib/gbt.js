// lib/gbt.js - 国家标准库：GB/T 15657-2021《中医病证分类与代码》
// 数据源：优先 data.db 的 ref_items(kind='gbt')（由 lib/refsync.js 从官方解析结果同步）；
//         参照库尚未就绪时回落 data/gbt-15657.json（随应用发布，首启/同步失败兜底）。
// 三库：disease 中医疾病(A) / syndrome 中医证候(B) / therapy 治法·疗法(C)
// 每条 {seq,code,name,aliases[]}；本模块附加 level/l1(一级类目代码)/l1Name 便于浏览检索。
'use strict';
const DB = require('./db');

const KINDS = ['disease', 'syndrome', 'therapy'];
const KIND_LABEL = { disease: '病名', syndrome: '证候', therapy: '治法' };
const L1_NAME = { disease: '中医疾病分类', syndrome: '中医证候分类', therapy: '治法分类' };

// 一级类目名去术语尾缀：'外感病类术语' → '外感病'
function cleanL1(n) {
  return String(n || '')
    .replace(/类术语$/, '').replace(/术语$/, '')
    .replace(/类病$/, '').replace(/类$/u, '') || n;
}

// ---------- 数据装载（db 优先，按 ref_meta.version 失效缓存；JSON 兜底） ----------
let _store = null;   // { disease:{arr,cats,byName,set}, ... }
let _ver = '';       // 当前缓存对应的数据版本

// 只读版本号（轻量：单行查询），版本未变则不加载数据
function dbVersion() {
  try {
    const meta = DB.refMeta('gbt');
    return meta && meta.count ? (String(meta.version) + '#' + meta.count) : '';
  } catch (e) { return ''; } // db 未初始化 / 查询异常 → 走 JSON 兜底
}

function build(raw) {
  const store = {};
  for (const kind of KINDS) {
    const arr = (raw[kind] || []).map(x => {
      const code = String(x.code || '');
      const l1 = code.slice(0, 3);                 // A01 / B02 / C03
      const level = code.replace(/\.$/, '').split('.').length;
      return {
        seq: x.seq, code, name: x.name, aliases: (x.aliases || []).slice(),
        l1, level, leaf: false
      };
    });
    // 叶子判定：无任何条目以本 code 为父级(除自身)
    const set = new Set(arr.map(x => x.code));
    arr.forEach(x => { x.leaf = ![...set].some(c => c !== x.code && c.startsWith(x.code)); });
    // 一级类目 name：取 code == l1 + '.' 的条目(类目行) 或第一条
    const l1names = {};
    for (const x of arr) if (x.code === x.l1 + '.') l1names[x.l1] = cleanL1(x.name);
    const cats = [];
    for (const x of arr) {
      if (!l1names[x.l1]) l1names[x.l1] = cleanL1(x.name);
    }
    const seenL1 = new Set();
    for (const x of arr) {
      if (seenL1.has(x.l1)) continue;
      seenL1.add(x.l1);
      cats.push({ code: x.l1, name: l1names[x.l1] || x.l1,
        count: arr.filter(y => y.l1 === x.l1).length });
    }
    arr.forEach(x => { x.l1Name = l1names[x.l1] || ''; });
    // 检索串预计算：admin 检索框每次输入都全表扫描，避免重复 join/toLowerCase
    arr.forEach(x => {
      x.hay = [x.code, x.name, x.l1Name, (x.aliases || []).join(' ')].join(' ').toLowerCase();
    });
    // 检索索引
    const byName = new Map();
    for (const x of arr) { if (!byName.has(x.name)) byName.set(x.name, x); }
    store[kind] = { arr, cats, byName, set };
  }
  return store;
}

function ensure() {
  const v = dbVersion();
  if (v) {
    if (_store && _ver === v) return _store;      // 命中缓存：仅一次单行查询
    const all = DB.refLoad('gbt');               // 版本变化才整表加载
    if (all.length) {
      const raw = { disease: [], syndrome: [], therapy: [] };
      for (const x of all) { const k = x && x.kind; if (raw[k]) raw[k].push(x); }
      for (const k of KINDS) raw[k].sort((a, b) => (a.seq || 0) - (b.seq || 0)); // 还原官方序号顺序
      _store = build(raw); _ver = v;
      return _store;
    }
  }
  if (!_store) { _store = build(require('../data/gbt-15657.json')); _ver = 'json-fallback'; }
  return _store;
}

function stats() {
  const store = ensure();
  const out = { total: 0, source: _ver === 'json-fallback' ? 'json' : 'db' };
  for (const kind of KINDS) {
    const s = store[kind];
    out[kind] = { count: s.arr.length, cats: s.cats };
    out.total += s.arr.length;
  }
  return out;
}

// q: 关键词（代码片段/正名/可选词/类目名），kind: 'all'|kind, l1: 一级类目代码筛选
function search(q, kind = 'all', l1 = '', max = 500) {
  const store = ensure();
  const kw = String(q || '').trim().toLowerCase();
  const out = [];
  for (const k of KINDS) {
    if (kind !== 'all' && kind !== k) continue;
    const { arr } = store[k];
    for (const x of arr) {
      if (l1 && x.l1 !== l1) continue;
      if (!kw) { out.push(x); if (out.length >= max) break; continue; }
      if (x.hay.includes(kw)) { out.push(x); if (out.length >= max) break; }
    }
    if (out.length >= max) break;
  }
  return { list: out, truncated: out.length >= max };
}

// 对一组辨证诊断名做国标疾病同名匹配（正名优先，其次可选用词）
// 返回 Map: name -> { code, l1, l1Name, gbtName, match:'name'|'alias' }
function matchNames(names) {
  const dis = ensure().disease;
  const res = new Map();
  for (const nm of names) {
    if (!nm) continue;
    const hit = dis.byName.get(nm);
    if (hit) { res.set(nm, { code: hit.code, l1: hit.l1, l1Name: hit.l1Name, gbtName: hit.name, match: 'name' }); continue; }
    // 别名匹配（可选用词）
    for (const x of dis.arr) {
      if ((x.aliases || []).includes(nm)) {
        res.set(nm, { code: x.code, l1: x.l1, l1Name: x.l1Name, gbtName: x.name, match: 'alias' });
        break;
      }
    }
  }
  return res;
}

// ---------- 诊断名归一（2026-10-19）：按国标库比对，可选用词/简写收敛为正名 ----------
// 只做确定性归一：精确正名 → 可选用词(alias) → 证型补「证」尾 → 唯一包含；
// 匹配不到或候选并列（歧义）时原样返回——宁缺勿错，不做模糊改写。
// 与 Domain/Gbt.cs NormalizeName 逐字同源（对拍 chan_diag_norm）。
function normalizeName(name, kind) {
  const t = String(name || '').trim();
  if (!t || (kind !== 'disease' && kind !== 'syndrome')) return t;
  const g = ensure()[kind];
  if (g.byName.has(t)) return g.byName.get(t).name;
  for (const x of g.arr) {
    // 可选用词（别名）本就是标准术语（如 乳岩/汗病）：HIS 怎么写就怎么留，不强制改写正名（2026-10-23）
    if ((x.aliases || []).includes(t)) return t;
  }
  // 证型简写（漏「证」尾）：气虚血瘀 → 气虚血瘀证
  if (kind === 'syndrome' && !/证$/.test(t) && g.byName.has(t + '证')) {
    return g.byName.get(t + '证').name;
  }
  const names = new Set(g.arr.map(x => x.name));
  // 包含式①：库内正名 ⊂ token（token 更长，如「外感咳嗽病」⊃「外感咳嗽」）→ 唯一最长命中
  const sup = [...names].filter(n => n.length >= 2 && n.length < t.length && t.includes(n));
  if (sup.length) {
    const maxL = Math.max(...sup.map(n => n.length));
    const top = sup.filter(n => n.length === maxL);
    if (top.length === 1) return top[0];
  }
  // 包含式②：token ⊂ 库内正名（缩写，≥3 字防短词误伤）→ 唯一最短命中
  if (t.length >= 3) {
    const sub = [...names].filter(n => n.length > t.length && n.includes(t));
    if (sub.length) {
      const minL = Math.min(...sub.map(n => n.length));
      const top = sub.filter(n => n.length === minL);
      if (top.length === 1) return top[0];
    }
  }
  return t;
}

module.exports = {
  KINDS, KIND_LABEL, L1_NAME, stats, search, matchNames, normalizeName,
  get store() { return ensure(); },
  source: () => (_ver === 'json-fallback' ? 'json' : 'db')
};
