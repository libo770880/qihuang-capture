// 回归：处方识别质检（rxqc）—— 缺剂量 / 药名未入库 / 剂量异常 / 缺用法剂数，以及拦截放行口径
const T = require('../lib/tcm');
const QC = require('../lib/rxqc');

const run = (text, usage) => {
  const tcm = T.runTcm({ text, usage: usage || '' });
  return QC.check({ text, tcm, usage: usage || (tcm && tcm.usage) || '' });
};
const codes = q => (q.items || []).flatMap(x => x.issues.map(g => g.code)).concat((q.rx || []).map(g => g.code));

const cases = [
  // ① 缺剂量：党参无 g 值 → error → 拦截
  ['noDose', '黄芪 15g\n党参\n白术 10g\n茯苓 12g', '', q => codes(q).includes('noDose') && q.block && q.errN === 1],
  // ② 药名未入库：库外药「美黄」→ unknown → 拦截
  ['unknown', '美黄 10g\n黄芪 15g\n甘草 6g', '每日1剂 水煎服', q => codes(q).includes('unknown') && q.block && q.items.some(x => x.unknown)],
  // ③ 剂量异常：500g 超区间 → doseOdd → 拦截
  ['doseOdd', '石膏 500g\n甘草 6g', '每日1剂 水煎服', q => codes(q).includes('doseOdd') && q.block],
  // ④ 缺用法（有处方无用法）→ warn，不拦截
  ['noUsage', '黄芪 15g\n白术 10g\n茯苓 12g', '', q => codes(q).includes('noUsage') && !q.block && q.warnN === 1],
  // ⑤ 缺剂数（有用法无 N 剂）→ warn，不拦截
  ['noJi', '黄芪 15g\n白术 10g\n茯苓 12g', '水煎服 分两次服', q => codes(q).includes('noJi') && !q.block],
  // ⑥ 规范处方（有剂量 + 每日1剂）→ 无任何问题
  ['clean', '黄芪 15g\n白术 10g\n茯苓 12g\n甘草 6g', '每日1剂 水煎服 分早晚两次饭后内服',
    q => q.level === 'ok' && q.errN === 0 && q.warnN === 0 && q.n === 0 && !q.block],
  // ⑦ 非重量单位（丸/粒/ml）不算缺剂量
  ['nonWeight', '黄芪 15g\n六味地黄丸 8丸\n甘草 6g', '每日1剂 水煎服', q => !codes(q).includes('noDose') && !q.block],
  // ⑧ 拦截文案
  ['blockMsg', '黄芪 15g\n党参\n白术 10g', '', q => /待修正/.test(QC.blockMsg(q)) && /强制分析/.test(QC.blockMsg(q))],
  // ⑨ 无处方内容（纯病历文本）→ 空质检，不误伤
  ['noRx', '患者诉腰痛，活动受限，纳眠可，二便调。', '', q => q.level === 'ok' && q.items.length === 0],
  // ⑩ 汇总文案按固定顺序（缺剂量在前）
  ['summary', '美黄 10g\n石膏 500g\n党参\n白术 10g', '', q => /缺剂量/.test(q.summary) && /药名未入库/.test(q.summary) && /剂量异常/.test(q.summary)],
];

let pass = 0;
for (const [name, text, usage, fn] of cases) {
  let q = null, ok = false, err = null;
  try { q = run(text, usage); ok = !!fn(q); } catch (e) { err = e.message; }
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(10)} ${ok ? '' : JSON.stringify({ err, q: q && { level: q.level, errN: q.errN, warnN: q.warnN, codes: codes(q), summary: q.summary } })}`);
}
console.log(`${pass}/${cases.length} ${pass === cases.length ? 'RXQC_TEST_OK' : 'RXQC_TEST_FAIL'}`);
process.exit(pass === cases.length ? 0 : 1);
