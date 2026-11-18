// scripts/_dump_builtin_kb.js - 把 lib/kb.js + lib/herbcat.js 的内置知识库导出为 JSON
// 用途：.NET 宿主版（net/QhjfCapture）直接加载，避免把 800+ 行中医数据在 C# 里重新抄一遍。
// 数据只有一份源（lib/kb*.js / lib/herbcat.js），本脚本负责生成产物 data/builtin-kb.json。
//
// 用法: node scripts/_dump_builtin_kb.js
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KB = require('../lib/kb');
const herbCat = require('../lib/herbcat');

const OUT = path.join(__dirname, '..', 'data', 'builtin-kb.json');

const herbs = KB.getBuiltinHerbs().map(h => ({
  ...h,
  sx: herbCat.symptomsOf(h.fx, h.note),
}));
const formulas = KB.getBuiltinFormulas();

const payload = {
  _comment: '由 scripts/_dump_builtin_kb.js 从 lib/kb*.js + lib/herbcat.js 生成，请勿手工编辑',
  _generated: new Date().toISOString(),
  counts: { herbs: herbs.length, formulas: formulas.length },

  herbs,
  formulas,

  // 正名解析表（含内置别名 + 规则用名 + OCR 形近注入键）与干净键集
  canon: KB.getCanon(),
  cleanCanonKeys: KB.getCleanCanonKeys(),
  ocrHerbFix: KB.OCR_HERB_FIX,

  // 规则表
  rules: {
    shibaFan: KB.SHIBA_FAN,
    shijiuWei: KB.SHIJIU_WEI,
    toxLimits: KB.TOX_LIMITS,
    doseLimits: KB.DOSE_LIMITS,
    rawToxic: KB.RAW_TOXIC,
    pregForbid: KB.PREG_FORBID,
    pregCaution: KB.PREG_CAUTION,
    pregWords: KB.PREG_WORDS,
    westDrugs: KB.WEST_DRUGS,
    anticoag: KB.ANTICOAG,
    drugInteract: KB.DRUG_INTERACT,
    stackRules: KB.STACK_RULES,
  },

  // 分类/症状推断规则（正则以 source 形式导出，C# 用 Regex 复刻）
  herbCat: {
    catRules: herbCat.CAT_RULES.map(([name, re]) => [name, re.source]),
    catOverrides: herbCat.CAT_OVERRIDES,
    symptomPatterns: herbCat.SYMPTOM_PATTERNS.map(([name, re]) => [name, re.source]),
  },
};

const json = JSON.stringify(payload);
payload.sha256 = crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 1), 'utf8');

const size = fs.statSync(OUT).size;
console.log(`[dump] ${OUT}`);
console.log(`[dump] herbs=${herbs.length} formulas=${formulas.length} ` +
  `canon=${Object.keys(payload.canon).length} cleanKeys=${payload.cleanCanonKeys.length} ` +
  `ocrFix=${Object.keys(payload.ocrHerbFix).length} sha=${payload.sha256}`);
console.log(`[dump] size=${(size / 1024).toFixed(1)}KB`);
