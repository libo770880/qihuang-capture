// lib/rxqc.js - 处方识别质检（红框标选 + 拦截分析）
// 场景：框选抓取 / 粘贴 / 拍照 得到处方文本后，识别出的中药若有「缺剂量 / 药名未入知识库 /
// 剂量异常 / 缺用法剂数」，面板用红框标出该药味，并在未修正前拦截本地分析与 AI 分析
// （用户可点「强制分析」放行）。判定纯函数、不落库副作用；C# 镜像见 Domain/RxQc.cs。
'use strict';

// 单剂剂量合理区间（g）：超出即判「剂量异常」（多为 OCR 把「12g」识成「120g/1200g」）
const DOSE_MAX = 200;
const DOSE_MIN = 0.5;
// 处方级「缺用法」判定所需的最少药味数（1 味多为单味说明，不苛求用法）
const USAGE_MIN_HERBS = 2;
// 非重量单位不参与「缺剂量/剂量异常」判定（丸/粒/片/ml 等本就没有 g 值）
const NON_WEIGHT = ['ml', '毫升', 'mg', '粒', '片', '丸', '包', '袋', '支', '贴', '枚', 'IU', 'iu'];

const CODE_LABEL = {
  noDose: '缺剂量',
  unknown: '药名未入库',
  doseOdd: '剂量异常',
  noUsage: '缺用法',
  noJi: '缺剂数'
};
const CODE_TIP = {
  noDose: '未识别到该味药的用量（g/克），请核对截图或手填剂量后再分析',
  unknown: '药名不在中药知识库（疑 OCR 错字或库外药），已自动进 AI 补库队列',
  doseOdd: '识别剂量超出常规范围（0.5–200 g/剂），疑为 OCR 误识，请核对后修正',
  noUsage: '未识别到用法用量（每日几剂 / 水煎服），影响超剂量与疗程判定',
  noJi: '用法中未见「每日N剂 / 共N剂」，无法折算每日剂量与疗程'
};

function doseVal(d) {
  if (d == null) return null;
  if (typeof d === 'number') return isFinite(d) ? d : null;
  if (typeof d === 'string') {
    const m = d.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  }
  if (typeof d === 'object') {
    const v = Number(d.val);
    return isFinite(v) ? v : null;
  }
  return null;
}
function doseUnit(d) {
  if (d && typeof d === 'object' && typeof d.unit === 'string') return d.unit.toLowerCase();
  if (typeof d === 'string') {
    const m = d.match(/(g|克|钱|分|两|ml|毫升|mg|粒|片|丸|包|袋|支|贴|枚)/i);
    return m ? m[1].toLowerCase() : '';
  }
  return '';
}
function isNonWeight(d) {
  const u = doseUnit(d);
  return !!u && NON_WEIGHT.indexOf(u) >= 0;
}
// 用法里是否含剂数（每日N剂 / 共N剂 / N剂）
function hasJi(txt) {
  return /(?:每日|每\s*日|日)\s*\d+(?:\.\d+)?\s*剂/.test(txt) || /共?\s*\d+\s*味\s*\d+\s*剂/.test(txt) || /\d+\s*剂/.test(txt);
}

/**
 * 处方识别质检。
 * @param {object} p { text, tcm, usage }
 * @returns {object} { ok, block, level, errN, warnN, n, items:[{name,dose,unknown,issues:[{code,level,label,tip}]}], rx:[...], summary }
 */
function check(p) {
  const o = p || {};
  const tcm = o.tcm && o.tcm.ok !== false ? o.tcm : null;
  const herbs = tcm && Array.isArray(tcm.herbs) ? tcm.herbs.filter(Boolean) : [];
  const doses = (tcm && tcm.herbDoses) || {};
  // 未匹配药名清单在 tcm.rx.stat.miss（tcm.stat 为兼容旧结构的备用路径）
  const stat = (tcm && tcm.rx && tcm.rx.stat) || (tcm && tcm.stat) || null;
  const miss = stat && Array.isArray(stat.miss)
    ? stat.miss.map(x => String(x || '').trim()).filter(Boolean) : [];
  const usageTxt = String(o.usage || (tcm && tcm.usage) || '').trim();

  const items = [];
  let errN = 0, warnN = 0;

  // ① 已识别药味：缺剂量 / 剂量异常
  for (const h of herbs) {
    const d = doses[h];
    const issues = [];
    const v = doseVal(d);
    if (v == null) {
      if (isNonWeight(d)) { /* 丸/粒/ml 等非重量单位：不算缺剂量 */ }
      else issues.push({ code: 'noDose', level: 'error', label: CODE_LABEL.noDose, tip: CODE_TIP.noDose });
    } else if (v > DOSE_MAX || v < DOSE_MIN) {
      issues.push({ code: 'doseOdd', level: 'error', label: CODE_LABEL.doseOdd, tip: CODE_TIP.doseOdd });
    }
    if (!issues.length) continue;
    for (const it of issues) { if (it.level === 'error') errN++; else warnN++; }
    items.push({ name: String(h), dose: v == null ? null : v, unit: doseUnit(d) || '', unknown: false, issues });
  }
  // ② 未入库药名（OCR 错字 / 库外药）：不在 herbSet 里，单独列出以便红框标出。
  //    用法/频次/表头词（日一剂、水煎内服、单剂用量…）是列式误读残留，不是药名——不标未入库、
  //    不计错误数、不进 AI 补库队列（2026-10-19，与 lib/tcm.js USAGE_WORD_SRC 同源）。
  const RX_PSEUDO_RE = /^(?:水煎内服|水煎服|水煎|煎服|内服|口服|外用|日一剂|每日一剂|日[0-9一二两三四五]+剂|每日[0-9一二两三四五]+剂|单剂用量|单剂量|每剂用量|用量|剂量|饮片)$/;
  for (const raw of miss) {
    if (herbs.indexOf(raw) >= 0) continue;
    if (RX_PSEUDO_RE.test(raw)) continue;
    if (items.some(x => x.name === raw)) continue;
    errN++;
    items.push({
      name: raw, dose: null, unit: '', unknown: true,
      issues: [{ code: 'unknown', level: 'error', label: CODE_LABEL.unknown, tip: CODE_TIP.unknown }]
    });
  }
  // ③ 处方级：缺用法 / 缺剂数（仅提示，不拦截）
  const rx = [];
  if (herbs.length >= USAGE_MIN_HERBS) {
    if (!usageTxt) rx.push({ code: 'noUsage', level: 'warn', label: CODE_LABEL.noUsage, tip: CODE_TIP.noUsage });
    else if (!hasJi(usageTxt)) rx.push({ code: 'noJi', level: 'warn', label: CODE_LABEL.noJi, tip: CODE_TIP.noJi });
  }
  // ④ 库比对提示：识别名与中药库规范名不同（别名/编辑距离纠错替换）——仅提示不拦截、不计入 errN/warnN；
  //    与 error 项同名的不再重复提示（如 黄连 已报缺剂量）
  const subs = [];
  if (tcm && Array.isArray(tcm.subs)) {
    for (const s of tcm.subs) {
      if (!s || !s.raw || !s.canon) continue;
      if (items.some(x => x.name === s.raw) || subs.some(x => x.raw === s.raw)) continue;
      subs.push({ raw: String(s.raw), canon: String(s.canon), fuzzy: !!s.fuzzy });
    }
  }
  for (const it of rx) { if (it.level === 'error') errN++; else warnN++; }

  // 汇总文案（按 code 计数，顺序固定）
  const cnt = {};
  for (const it of items) for (const g of it.issues) cnt[g.code] = (cnt[g.code] || 0) + 1;
  for (const g of rx) cnt[g.code] = (cnt[g.code] || 0) + 1;
  const summary = Object.keys(CODE_LABEL)
    .filter(k => cnt[k])
    .map(k => CODE_LABEL[k] + ' ' + cnt[k] + (k === 'noUsage' || k === 'noJi' ? '' : ' 味'))
    .join(' · ');

  const n = items.length + rx.length;
  const block = errN > 0;
  return {
    ok: true, block, level: block ? 'block' : (warnN > 0 ? 'warn' : 'ok'),
    errN, warnN, n, items, rx, subs, summary,
    doseMin: DOSE_MIN, doseMax: DOSE_MAX
  };
}

/** 拦截态下给前端的提示语（两侧文案一致） */
function blockMsg(qc) {
  const q = qc || {};
  const n = q.errN || 0;
  return `识别结果有 ${n} 项待修正（${q.summary || ''}）：请核对红框标出的药味后再分析；确认无误可点「强制分析」放行。`;
}

module.exports = { check, blockMsg, doseVal, hasJi, DOSE_MIN, DOSE_MAX, CODE_LABEL, CODE_TIP };
