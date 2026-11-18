// lib/rxrule.js - 处方点评「红线规则」配置存取（后台「点评红线」页签维护）
// 配置存 SQLite kv 表 k='rxrule'；未配置时取 rxreview.DEFAULT_RULES。
// 归一化/校验统一走 RxReview.normalizeRules（与 C# 侧 Domain/RxRule.cs 逐字同源，勿单边修改）。
const DB = require('./db');
const RX = require('./rxreview');

const KEY = 'rxrule';

function raw() {
  const v = DB.kvGet(KEY);
  return (v && typeof v === 'object') ? v : {};
}

/** 当前生效红线（已归一化，缺省即默认）。 */
function get() {
  return { ok: true, rules: RX.normalizeRules(raw()), defaults: { ...RX.DEFAULT_RULES } };
}

/**
 * 保存红线配置（局部更新：只传要改的字段）。
 * @param {object} patch 如 { herbWarn: 15, doseOn: false }
 */
function set(patch) {
  const p = (patch && typeof patch === 'object') ? patch : {};
  const next = RX.normalizeRules(Object.assign({}, raw(), p));
  DB.kvSet(KEY, next);
  return { ok: true, rules: next };
}

/** 恢复出厂默认（保留结构，清空自定义值）。 */
function reset() {
  const next = RX.normalizeRules(RX.DEFAULT_RULES);
  DB.kvSet(KEY, next);
  return { ok: true, rules: next };
}

module.exports = { get, set, reset, KEY };
