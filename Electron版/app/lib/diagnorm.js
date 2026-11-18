// lib/diagnorm.js - 诊断要素按后台诊断库比对归一（2026-10-19）
// 中医诊断 ← GB/T 15657 病名库(disease)、证型 ← 证候库(syndrome)、西医诊断 ← ICD-10 国临版正名。
// 做的事：去无用符号（括号及内容/首尾标点/纯符号段）、可选用词→正名、证型简写补「证」尾、
//         唯一包含收敛、多诊断去重并以「、」连接；匹配不到原样保留（宁缺勿错，不做模糊改写）。
// 与 Domain/DiagNorm.cs 逐字同源（对拍 chan_diag_norm）。
'use strict';
const gbt = require('./gbt');
const icdmap = require('./icdmap');

const SPLIT_RE = /[，,、;；]+/;

// OCR 丢右括号（「胸痹（气滞血瘀证」）：配对括号剔除后仍残留到串尾的未闭合左括号连内容一并截断。
// 诊断字段里括号内容通常是证型/备注（证型有独立字段），截断不丢有效诊断信息。
function cutOpenParen(s) {
  return String(s || '').replace(/（[^（）]*$/, '').replace(/\([^()]*$/, '');
}
// 纯噪声段（HIS 版块标签被 region 误抓混进诊断行）：整段丢弃
const NOISE_RE = /^(?:中药汤剂|中药饮片|汤剂|中成药|西药|饮片|中药|煎药|临方加工)$/;
// 去括号及内容（（双）（左）（未闭合截断）等）、去首尾非文字符号
function cleanToken(s) {
  return cutOpenParen(
    String(s || '')
      .replace(/（[^（）]*）/g, '').replace(/\([^()]*\)/g, '')
      .replace(/^[^\u4e00-\u9fa5A-Za-z0-9]+|[^\u4e00-\u9fa5A-Za-z0-9]+$/g, '')
  ).trim();
}
// 清洗后须含 ≥2 连续汉字/字母（「Ⅱ级」单字级、纯数字序号都是噪声段 → 丢弃）
function isUseful(s) { return /[\u4e00-\u9fa5A-Za-z]{2,}/.test(s); }

function normalizeList(v, fn) {
  const out = []; const fixes = [];
  for (const raw of String(v || '').split(SPLIT_RE)) {
    const p = cleanToken(raw);
    if (!p || !isUseful(p) || NOISE_RE.test(p)) continue;
    const n = fn(p) || p;
    if (n !== p) fixes.push(p + '→' + n);
    if (!out.includes(n)) out.push(n);
  }
  return { val: out.join('、'), fixes };
}

function normalizeKeys(keys) {
  const fixes = [];
  if (keys['中医诊断']) {
    const r = normalizeList(keys['中医诊断'], p => gbt.normalizeName(p, 'disease'));
    if (r.val) keys['中医诊断'] = r.val; else delete keys['中医诊断'];
    fixes.push(...r.fixes);
  }
  if (keys['证型']) {
    const r = normalizeList(keys['证型'], p => gbt.normalizeName(p, 'syndrome'));
    if (r.val) keys['证型'] = r.val; else delete keys['证型'];
    fixes.push(...r.fixes);
  }
  if (keys['西医诊断']) {
    const r = normalizeList(keys['西医诊断'], p => icdmap.normalizeName(p));
    if (r.val) keys['西医诊断'] = r.val; else delete keys['西医诊断'];
    fixes.push(...r.fixes);
  }
  return fixes;
}

// 单字段归一（panel 手改诊断/证型保存路径用）：空值原样返回
function normalizeField(name, val) {
  const v = String(val || '').trim();
  if (!v) return v;
  const k = {};
  k[name] = v;
  try { normalizeKeys(k); } catch (e) { return v; }
  return k[name] || v;
}

module.exports = { normalizeKeys, normalizeField };
