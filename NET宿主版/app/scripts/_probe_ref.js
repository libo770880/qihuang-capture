// scripts/_probe_ref.js - 输出 Electron 版业务层的「基线指标」，用于与 .NET 版对拍
//
// 用途：.NET 迁移过程中，两边跑同一组指标，逐项比对数值是否一致，
//       以此证明 C# 复刻没有行为漂移（比读代码更可靠）。
//
// 用法: node scripts/_probe_ref.js
// 对拍: QhjfCapture.exe --probe-db  输出的 [probe] 段
'use strict';
const path = require('path');

const USER_DATA = process.env.QHJF_USERDATA ||
  path.join(process.env.APPDATA || '', '岐黄鉴方·悬浮采集助手');

const DB = require('../lib/db');
const KB = require('../lib/kb');
const herbCat = require('../lib/herbcat');

DB.initDb(USER_DATA);

const userKb = require('../lib/userkb').initUserKb(USER_DATA);
const clinicalKb = require('../lib/clinicalkb').initClinicalKb(USER_DATA);

const canon = KB.getCanon();
const aliasCases = {
  '元胡': '延胡索', '夜交藤': '首乌藤', '川牛膝': '牛膝',
  '田七': '三七', '生地': '生地黄', '炙甘草': '甘草',
  '臼术': '白术', '白勺': '白芍', '黄苓': '黄芩', '川穹': '川芎',
  '制吴茱萸': '吴茱萸', '麸炒白术': '白术',
};
const aliasResult = {};
for (const [a, want] of Object.entries(aliasCases)) {
  aliasResult[a] = { got: canon[a] || null, ok: canon[a] === want };
}

const incompat = KB.getAllIncompat();
const sbf = userKb.sbfList();
const clinical = clinicalKb.stats();
const ukStats = userKb.stats();
const yb = userKb.ybList();

const out = {
  userData: USER_DATA,
  kb: {
    herbs: KB.getBuiltinHerbs().length,
    formulas: KB.getBuiltinFormulas().length,
    canon: Object.keys(canon).length,
    cleanKeys: KB.getCleanCanonKeys().length,
    ocrHerbFix: Object.keys(KB.OCR_HERB_FIX).length,
  },
  herbCat: {
    rules: herbCat.CAT_RULES.length,
    overrides: Object.keys(herbCat.CAT_OVERRIDES).length,
    symptoms: herbCat.SYMPTOM_PATTERNS.length,
    classifyDemo: herbCat.classifyHerb('黄芪', '补气升阳'),
  },
  rules: {
    incompat: incompat.length,
    toxLimits: KB.TOX_LIMITS.length,
    doseLimits: KB.DOSE_LIMITS.length,
    rawToxic: KB.RAW_TOXIC.length,
    pregForbid: KB.PREG_FORBID.length,
    pregCaution: KB.PREG_CAUTION.length,
    westDrugs: KB.WEST_DRUGS.length,
    anticoag: KB.ANTICOAG.length,
  },
  alias: aliasResult,
  ocrFixDemo: KB.fixOcrText('臼术12g 白勺10g 川穹6g'),
  userkb: {
    herb: ukStats.herbCount,
    formula: ukStats.formulaCount,
    herbBuiltin: ukStats.herbBuiltin,
    formulaBuiltin: ukStats.formulaBuiltin,
    ocrfix: userKb.ocrList().length,
    sbfBuiltin: sbf.builtin.length,
    sbfUser: sbf.user.length,
    yibao: yb.length,
    yibaoPayTypes: [...new Set(yb.map(r => r.payType))].sort(),
    unmatched: userKb.unmatchedList().length,
  },
  clinical: {
    diag: clinical.diagCount,
    symptom: clinical.symptomCount,
    symptomTcm: clinical.symptomTcm,
    symptomWest: clinical.symptomWest,
    syndromeCount: clinical.syndromeCount,
    westmap: clinical.westMapCount,
    syndromeRows: clinicalKb.syndromeRows().length,
  },
};

console.log(JSON.stringify(out, null, 1));
