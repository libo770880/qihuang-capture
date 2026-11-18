// 处方量化指标（lib/rxmetric.js）单测 —— 前台指标条与后台点评共用同一口径
// 运行：node scripts/_test_rxmetric.js
'use strict';
const M = require('../lib/rxmetric');
const TCM = require('../lib/tcm');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✕ ${name}\n      got  ${g}\n      want ${w}`); }
}
function near(name, got, want) { eq(name, Math.abs(got - want) < 1e-9, true); }

const items = [
  { canon: '黄芪', dose: { val: 15, unit: 'g' } },
  { canon: '白术', dose: { val: 10, unit: 'g' } },
  { canon: '甘草', dose: { val: 6, unit: 'g' } },
];

console.log('== rxMetrics ==');
// ① 基本：3 味 31g/剂，7 剂每日1剂 → 天数 7、总计 217g、均 10.33
let m = M.rxMetrics({ items, text: '黄芪15g 白术10g 甘草6g 共3味7剂', usage: '每日1剂 水煎服' });
eq('① herbN/doseN', [m.herbN, m.doseN], [3, 3]);
near('① doseG', m.doseG, 31);
near('① dailyG', m.dailyG, 31);
eq('① ji/days', [m.ji, m.days], [7, 7]);
near('① totalG', m.totalG, 217);
near('① avgG', m.avgG, 10.33);
eq('① maxG/maxN', [m.maxG, m.maxN], [15, '黄芪']);

// ② 每日2剂：天数 = 7/2 = 3.5，每日克数 = 62
m = M.rxMetrics({ items, text: '共3味7剂', usage: '每日2剂 水煎服' });
near('② dailyJi/dailyG', m.dailyJi + m.dailyG * 0, 2);
near('② dailyG', m.dailyG, 62);
near('② days(7剂/每日2剂)', m.days, 3.5);
near('② totalG 不受每日剂数影响', m.totalG, 217);

// ③ 无剂数：days/totalG 归 0（不臆造天数）
m = M.rxMetrics({ items, text: '黄芪15g 白术10g 甘草6g', usage: '水煎服' });
eq('③ ji=0 时 days/totalG=0', [m.ji, m.days, m.totalG], [0, 0, 0]);

// ④ 剂数不被「每日N剂」污染：先剔除用法中的剂数
m = M.rxMetrics({ items, text: '每日1剂 水煎服 共3味7剂', usage: '每日1剂 水煎服' });
eq('④ 取「共3味7剂」为剂数', m.ji, 7);
m = M.rxMetrics({ items, text: '每日1剂 水煎服', usage: '每日1剂' });
eq('④ 只有用法时剂数为 0', m.ji, 0);

// ⑤ 非重量单位不计入克重：丸/粒/ml 走 noDoseN
m = M.rxMetrics({ items: [{ canon: '六味地黄丸', dose: { val: 8, unit: '丸' } }, ...items], text: '', usage: '' });
eq('⑤ 丸剂不计克重', [m.herbN, m.doseN, m.noDoseN, m.doseG], [4, 3, 1, 31]);

// ⑥ 缺剂量：noDoseN 计数，克重只算有剂量的
m = M.rxMetrics({ items: [{ canon: '黄芪' }, { canon: '白术', dose: { val: 10, unit: 'g' } }], text: '', usage: '' });
eq('⑥ 缺剂量计数', [m.herbN, m.doseN, m.noDoseN, m.doseG, m.avgG], [2, 1, 1, 10, 10]);

// ⑦ 「克」单位与 g 等价
m = M.rxMetrics({ items: [{ canon: '黄芪', dose: { val: 12.5, unit: '克' } }], text: '', usage: '' });
near('⑦ 克等价 g', m.doseG, 12.5);

// ⑧ 空输入不炸
m = M.rxMetrics({});
eq('⑧ 空输入', [m.herbN, m.doseG, m.ji, m.days, m.totalG], [0, 0, 0, 0, 0]);

// ⑨ 浮点尾巴：0.1+0.2 类累加必须收敛
m = M.rxMetrics({ items: [{ dose: { val: 0.1, unit: 'g' } }, { dose: { val: 0.2, unit: 'g' } }], text: '', usage: '' });
near('⑨ 浮点收敛', m.doseG, 0.3);

// ⑩ 与 rxreview 同源：pickJi / pickDailyJi 口径（剂数/每日剂数必须与点评红线判定一致）
eq('⑩ pickJi 共5味7剂', M.pickJi('共5味7剂'), 7);
eq('⑩ pickJi 剔除每日剂数', M.pickJi('每日1剂 水煎服'), 0);
near('⑩ pickDailyJi 每日2剂', M.pickDailyJi('每日2剂'), 2);
near('⑩ pickDailyJi 缺省 1', M.pickDailyJi('水煎服'), 1);

console.log('== runTcm 落库（rx.stat 携带指标）==');
const txt = '黄芪 15g\n白术 10g\n甘草 6g\n每日1剂 水煎服\n共3味7剂';
const t = TCM.runTcm({ text: txt });
const st = t.rx && t.rx.stat;
eq('⑪ stat 基础字段仍在', [st.total, st.hit], [3, 3]);
near('⑪ stat.doseG', st.doseG, 31);
eq('⑪ stat.ji/days', [st.ji, st.days], [7, 7]);
near('⑪ stat.totalG', st.totalG, 217);

console.log(`\n${fail ? '✕ FAIL' : '✓ ALL PASS'}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
