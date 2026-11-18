// lib/rxmetric.js —— 处方量化指标（点评口径）
// 纯函数、不碰 IO；C# 侧镜像见 net/QhjfCapture/Domain/RxMetric.cs，两侧必须逐字同源。
//
// 产出前台「处方指标条」与后台点评明细共用的量化口径：
//   味数 herbN / 单剂克数 doseG / 每日克数 dailyG / 剂数 ji / 天数 days / 总克数 totalG /
//   均味克数 avgG / 最重药味 maxG·maxN / 无剂量味数 noDoseN
//
// ⚠ pickJi 与 pickDailyJi 与 lib/rxreview.js 是同一套正则与取值口径（剂数决定天数、每日剂数决定单日克数），
//   改任一侧都必须同步另一侧，否则点评红线判定与前台展示会对不上。

'use strict';

// 每日剂数：「每日N剂」或 HIS 常见「1日1剂 / 1日2剂 / 日1剂」（「每」可省）——「日」前数字是天数不算
const RE_DAILY_JI = /(?:每\s*)?日\s*(\d+(?:\.\d+)?)\s*剂/;
// 剂数单位按中药处方习惯放宽：剂 / 付 / 帖（HIS 常打印「共7付」「7帖」；「剂型」「剂量」不算）
const RE_JI_WEI = /味\s*(\d{1,3})\s*(?:剂|付|帖)/;
const RE_JI = /(\d{1,3})\s*(?:剂|付|帖)(?!\s*[型量])/;

/** 每日剂数（用法「每日N剂 / 1日N剂 / 日N剂」，缺省 1 剂/日）——与 rxreview.pickDailyJi 同源 */
function pickDailyJi(usage) {
  const m = String(usage || '').match(RE_DAILY_JI);
  if (m) { const v = parseFloat(m[1]); if (isFinite(v) && v > 0) return v; }
  return 1;
}

/** 剂数（「共12味7剂」或「7剂 / 7付 / 7帖」；先剔除「每日N剂 / 1日N剂」避免把每日用法当剂数）——与 rxreview.pickJi 同源 */
function pickJi(text) {
  const t = String(text || '');
  if (!t) return 0;
  const cleared = t.replace(/(?:每\s*)?日\s*\d+\s*剂/g, '');
  let m = cleared.match(RE_JI_WEI);
  if (m) return parseInt(m[1], 10) || 0;
  m = cleared.match(RE_JI);
  if (m) return parseInt(m[1], 10) || 0;
  return 0;
}

/**
 * 剂数落定：手填（ji>0）优先，否则回落到原文自动识别（text 参与）。
 * 天数、总克数随剂数重算——这是「剂数手填」能带动指标条与点评红线的唯一口径。
 * @param {object} stat  rxMetrics 产出的 stat
 * @param {number} ji    手填剂数（0/空 = 自动识别）
 * @param {string} text  原文（自动识别用）
 */
function applyJi(stat, ji, text) {
  const s = Object.assign({}, stat || {});
  const v = Math.round(Number(ji) || 0);
  const eff = v > 0 ? v : pickJi(String(text || ''));
  if (v > 0) s.jiManual = true; else delete s.jiManual;
  const dailyJi = Number(s.dailyJi) > 0 ? Number(s.dailyJi) : 1;
  const doseG = Number(s.doseG) || 0;
  s.ji = eff;
  s.days = eff > 0 ? round2(eff / dailyJi) : 0;
  s.totalG = eff > 0 ? round2(doseG * eff) : 0;
  return s;
}

/** 两位小数去浮点尾巴：60 → 60，12.5 → 12.5，20.000000000000004 → 20 */
function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

/** 仅重量单位（g/克）计入克数；丸/粒/ml 等非重量单位不参与克重合计 */
function isWeightUnit(unit) {
  const u = String(unit || '').toLowerCase();
  return u === 'g' || u === '克';
}

/**
 * 处方量化指标。
 * @param {{items?:Array<{canon?:string,raw?:string,dose?:{val:number,unit:string}}>, text?:string, usage?:string}} o
 * @returns {{herbN:number,doseN:number,noDoseN:number,doseG:number,dailyJi:number,dailyG:number,ji:number,days:number,totalG:number,avgG:number,maxG:number,maxN:string}}
 */
function rxMetrics(o) {
  const opt = o || {};
  const items = Array.isArray(opt.items) ? opt.items : [];
  let doseG = 0, doseN = 0, noDoseN = 0, maxG = 0, maxN = '';
  for (const it of items) {
    const d = it && it.dose;
    if (!d || !isWeightUnit(d.unit)) { noDoseN++; continue; }
    const v = Number(d.val);
    if (!isFinite(v) || v <= 0) { noDoseN++; continue; }
    doseG += v; doseN++;
    if (v > maxG) { maxG = v; maxN = String(it.canon || it.raw || ''); }
  }
  doseG = round2(doseG);
  const dailyJi = pickDailyJi(opt.usage);
  const ji = pickJi(opt.text);
  const dailyG = round2(doseG * dailyJi);
  const totalG = ji > 0 ? round2(doseG * ji) : 0;
  const days = ji > 0 ? round2(ji / dailyJi) : 0;
  const avgG = doseN > 0 ? round2(doseG / doseN) : 0;
  return {
    herbN: items.length, doseN, noDoseN,
    doseG, dailyJi, dailyG, ji, days, totalG, avgG,
    maxG: round2(maxG), maxN
  };
}

module.exports = { rxMetrics, pickJi, pickDailyJi, applyJi, round2, isWeightUnit };
