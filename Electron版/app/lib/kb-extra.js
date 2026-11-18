// lib/kb-extra.js - 岐黄鉴方 知识库扩充聚合器
// 汇总：出处/基原补齐表 + 新增中药 7 批 + 新增方剂 2 批
// kb.js require 本模块后自动去重合并进内置库。
const { HERB_ORIGIN, FORMULA_ORIGIN } = require('./kborig');
const { MORE_HERB_ROWS: H_A } = require('./kb-herbs-a');
const { MORE_HERB_ROWS: H_B } = require('./kb-herbs-b');
const { MORE_HERB_ROWS: H_C } = require('./kb-herbs-c');
const { MORE_HERB_ROWS: H_D } = require('./kb-herbs-d');
const { MORE_HERB_ROWS: H_E } = require('./kb-herbs-e');
const { MORE_HERB_ROWS: H_F } = require('./kb-herbs-f');
const { MORE_HERB_ROWS: H_G } = require('./kb-herbs-g');
const { MORE_HERB_ROWS: H_H } = require('./kb-herbs-h');
const { MORE_FORMULAS: F_A } = require('./kb-formulas-a');
const { MORE_FORMULAS: F_B } = require('./kb-formulas-b');
const { MORE_FORMULAS: F_C } = require('./kb-formulas-c');
const { MORE_FORMULAS: F_D } = require('./kb-formulas-d');
const { MORE_FORMULAS: F_E } = require('./kb-formulas-e');
const { MORE_FORMULAS: F_F } = require('./kb-formulas-f');

// 追加批内去重（保留先出现者），杜绝同批/跨批重复名
const MORE_HERB_ROWS = [];
{
  const seen = new Set();
  for (const row of [].concat(H_A, H_B, H_C, H_D, H_E, H_F, H_G, H_H)) {
    if (row && row[0] && !seen.has(row[0])) { seen.add(row[0]); MORE_HERB_ROWS.push(row); }
  }
}
const MORE_FORMULAS = [];
{
  const seen = new Set();
  for (const f of [].concat(F_A, F_B, F_C, F_D, F_E, F_F)) {
    if (f && f.n && !seen.has(f.n)) { seen.add(f.n); MORE_FORMULAS.push(f); }
  }
}

module.exports = { HERB_ORIGIN, FORMULA_ORIGIN, MORE_HERB_ROWS, MORE_FORMULAS };
