/**
 * 框选遮罩「药」按钮：对框选区识别出的文本做药味解析，输出
 * 「每味药说明（性味归经·功效） + 用法用量 + 预判方剂（按组成重合度排序）」卡片。
 *
 * 纯逻辑（不碰任何 Electron / DOM API），C# 镜像见 net/QhjfCapture/Domain/HerbCards.cs。
 * 两侧输出必须逐字一致——对拍场景 chan_herb_cards。
 */
const Tcm = require('./tcm');

const MAX_CARDS = 24;   // 卡片上限（大处方也只出前 24 味，防遮罩面板过长）
const MAX_PREDS = 3;    // 预判方剂条数
const MAX_MISS = 6;     // 缺味最多展示数

/**
 * 孕/毒标记 → 0/1。走字符串取值：内置库导出的 JSON 里这些字段是数字，
 * 而 C# 侧 Js.Num 对 JsonNode.Parse 产生的整数节点会返回 null，
 * 两侧若各自用「原生数值读取」必然漂移 —— 统一按字符串再 parse，结果恒等。
 */
function flagOf(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return 0;
  const n = Number(s);
  if (Number.isFinite(n)) return n > 0 ? 1 : 0;
  return 1; // 非空且非数字（慎用 / 忌用 / 有毒…）→ 视为有标记
}

/** 剂量对象 → 展示串（「15g」「1.5钱」）；无剂量返回空串 */
function doseText(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.trim();
  const v = d.val, u = d.unit;
  if (v === undefined || v === null || v === '') return '';
  const n = Number(v);
  const vs = Number.isFinite(n) ? String(Math.round(n * 100) / 100) : String(v);
  return vs + (u ? String(u) : '');
}

/**
 * @param {string} text 框选区 OCR / 粘贴得到的原文（调用方已按需做剔除规则清理）
 * @returns {{ok:boolean, error?:string, herbs:string[], cards:Array, preds:Array, usage:string, type:string, typeLabel:string, msg:string}}
 */
function build(text) {
  const src = String(text || '');
  const empty = { ok: false, error: 'empty', herbs: [], cards: [], preds: [], usage: '', type: 'none', typeLabel: '未识别到中医内容', msg: '框选区内未识别到药味' };
  if (!src.trim()) return empty;

  let t = null;
  try { t = Tcm.runTcm({ text: src }); } catch (e) { t = null; }
  if (!t || !t.ok) return { ok: false, error: 'tcm-failed', herbs: [], cards: [], preds: [], usage: '', type: 'none', typeLabel: '解析失败', msg: '处方解析失败，请重新框选' };

  const herbs = (t.herbs || []).slice(0, MAX_CARDS);

  // 每味药：说明（性味归经 + 功效）/ 用法（常规用量）/ 注意（禁忌）
  const cards = [];
  for (const c of (t.herbCards || [])) {
    if (!c) continue;
    cards.push({
      n: String(c.n || ''),
      cat: String(c.category || ''),
      prop: String(c.prop || ''),
      fx: String(c.fx || ''),
      use: String(c.use || ''),
      note: String(c.note || ''),
      dose: doseText(c.dose),
      tox: flagOf(c.tox),
      pre: flagOf(c.pre)
    });
    if (cards.length >= MAX_CARDS) break;
  }

  // 预判方剂：给药味集合，按「原方被命中比例 + 处方被解释比例」排序（含常规替换药）
  // 与 runTcm 内部的 guess 不同——这里**始终**计算，不受「是否已命中方名」影响。
  const preds = [];
  try {
    for (const g of (Tcm.guessByComposition(herbs) || [])) {
      const hit = g.hit || [];
      const subHits = g.subHits || [];
      const used = [...new Set(hit.concat(subHits.map(s => s.used)))];
      const compSize = Number(g.compSize || 0);
      const inter = Number(g.inter || used.length);
      preds.push({
        n: String((g.f && g.f.n) || ''),
        origin: String((g.f && g.f.origin) || ''),
        m: String((g.f && g.f.m) || ''),
        s: Array.isArray(g.f && g.f.s) ? (g.f.s || []).slice(0, 3).map(String) : [],
        comp: String((g.f && g.f.c) || ''),
        hit: used.map(String),
        miss: (g.miss || []).slice(0, MAX_MISS).map(String),
        inter: inter,
        compSize: compSize,
        // 重合度：原方命中比例（对「像不像这个方」更有判断力）
        covF: (compSize > 0 ? Math.round((inter / compSize) * 100) : 0),
        covRx: Math.round((Number(g.covRx || 0)) * 100),
        classic: !!g.classic
      });
      if (preds.length >= MAX_PREDS) break;
    }
  } catch (e) { /* 反查失败不影响药味卡片 */ }

  return {
    ok: true,
    herbs: herbs.map(String),
    cards: cards,
    preds: preds,
    usage: String(t.usage || ''),
    type: String(t.type || ''),
    typeLabel: String(t.typeLabel || ''),
    msg: String(t.msg || '')
  };
}

module.exports = { build, doseText };
