// 回归：处方点评「四条红线」—— 味数 / 单日剂量 / 天数 / 辨证（lib/rxreview.js 的 ctx.rules）
// 走真实引擎（runTcm + reviewOne），不碰数据库；C# 侧同源于 Domain/RxReview.cs（对拍场景 chan_rx_rule_*）。
const RX = require('../lib/rxreview');
const T = require('../lib/tcm');

const okList = [];
function ck(tag, cond, extra) {
  okList.push([tag, !!cond]);
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${tag}${cond ? '' : '  ← ' + (extra || '')}`);
}
const tags = (r) => r.items.map(i => `${i.level}:${i.tag}`);
const has = (r, t) => tags(r).includes(t);

// ① 味数红线：8 味，提醒 5 / 红线 8 → error 大处方；关掉后不再判
const HB = ['黄芪 15g', '白术 10g', '茯苓 15g', '陈皮 6g', '半夏 9g', '当归 12g', '川芎 10g', '白芍 15g', '每日1剂 水煎服'].join('\n');
const rHb = RX.reviewOne({ tcm: T.runTcm({ text: HB }), text: HB, rules: { herbWarn: 5, herbErr: 8 } });
ck('味数红线 error', has(rHb, 'error:大处方'), tags(rHb).join(','));
const rHbOff = RX.reviewOne({ tcm: T.runTcm({ text: HB }), text: HB, rules: { herbOn: false } });
ck('味数红线停用', !has(rHbOff, 'error:大处方') && !has(rHbOff, 'warn:大处方'), tags(rHbOff).join(','));

// ② 单日剂量红线：黄芪 90g × 每日2剂 = 180g/日 > 120 → error；外用豁免
const DOSE = '黄芪 90g\n甘草 6g\n每日2剂 水煎服';
const rDose = RX.reviewOne({ tcm: T.runTcm({ text: DOSE }), text: DOSE, rules: { doseWarn: 60, doseErr: 120 } });
ck('单日剂量红线 error', has(rDose, 'error:超剂量') && rDose.stat.dailyJi === 2 && rDose.stat.doseOverN === 1,
  JSON.stringify(rDose.stat));
const DOSE_EXT = '黄芪 90g\n甘草 6g\n每日2剂 外用';
const rExt = RX.reviewOne({ tcm: T.runTcm({ text: DOSE_EXT, usage: '外用' }), text: DOSE_EXT, usage: '外用', rules: { doseWarn: 60, doseErr: 120 } });
ck('外用豁免剂量红线', !has(rExt, 'error:超剂量') && rExt.stat.doseOverN === 0, JSON.stringify(rExt.stat));
// 提醒档：30g/日（每日1剂）> 20 → warn
const DOSE_W = '黄芪 30g\n甘草 6g\n每日1剂 水煎服';
const rDw = RX.reviewOne({ tcm: T.runTcm({ text: DOSE_W }), text: DOSE_W, rules: { doseWarn: 20, doseErr: 120 } });
ck('单日剂量提醒档 warn', has(rDw, 'warn:超剂量'), tags(rDw).join(','));

// ③ 天数红线：20 剂 > 红线 14 → error；7 剂（= 提醒值）不判
const JI = '黄芪 15g\n甘草 6g\n共2味20剂';
const rJi = RX.reviewOne({ tcm: T.runTcm({ text: JI }), text: JI, rules: { jiWarn: 7, jiErr: 14 } });
ck('天数红线 error', has(rJi, 'error:超疗程'), tags(rJi).join(','));
const JI7 = '黄芪 15g\n甘草 6g\n共2味7剂';
const rJi7 = RX.reviewOne({ tcm: T.runTcm({ text: JI7 }), text: JI7, rules: { jiWarn: 7, jiErr: 14 } });
ck('天数红线边界（7 剂不判）', !has(rJi7, 'warn:超疗程') && !has(rJi7, 'error:超疗程'), tags(rJi7).join(','));

// ④ 辨证红线：消渴·阴虚燥热 + 解表药 → 相符率 0% < 15 → error 方证不符
const SD = '麻黄 10g\n桂枝 10g\n荆芥 10g\n防风 10g\n生姜 6g';
const rSd = RX.reviewOne({
  tcm: T.runTcm({ text: SD, keys: { 中医诊断: '消渴', 证型: '阴虚燥热' } }),
  text: SD, diag: '消渴', synd: '阴虚燥热', rules: { syndRateWarn: 30, syndRateErr: 15 }
});
ck('辨证红线 error', has(rSd, 'error:方证不符') && rSd.stat.rate === 0, JSON.stringify(rSd.stat));
// 缺证型可判严重
const SD_MISS = '黄芪 15g\n白术 10g\n每日1剂 水煎服';
const rMiss = RX.reviewOne({
  tcm: T.runTcm({ text: SD_MISS, keys: { 中医诊断: '咳嗽' } }), text: SD_MISS, diag: '咳嗽',
  rules: { syndMiss: 'error' }
});
ck('缺证型判严重', has(rMiss, 'error:缺证型'), tags(rMiss).join(','));

// ⑤ 阈值自洽：红线值不得宽于提醒值（味数 err<warn 自动抬升；率类自动压低）
const n1 = RX.normalizeRules({ herbWarn: 20, herbErr: 10, syndRateWarn: 30, syndRateErr: 60 });
ck('阈值自洽纠正', n1.herbErr === 20 && n1.syndRateErr === 30, JSON.stringify(n1));
// ⑥ 非法值回落默认
const n2 = RX.normalizeRules({ herbWarn: 'abc', doseWarn: null, jiWarn: 9999 });
ck('非法值回落默认', n2.herbWarn === 20 && n2.doseWarn === 60 && n2.jiWarn === 999, JSON.stringify(n2));
// ⑦ 默认配置下：规范小方仍判合理（不因新增红线误伤）
const RX_OK = ['黄芪 15g', '白术 10g', '茯苓 15g', '陈皮 6g', '半夏 9g', '共5味7剂', '每日1剂 水煎服 分早晚两次饭后内服'].join('\n');
const rOk = RX.reviewOne({
  tcm: T.runTcm({ text: RX_OK, keys: { 中医诊断: '咳嗽', 证型: '痰湿蕴肺证' } }),
  text: RX_OK, diag: '咳嗽', synd: '痰湿蕴肺证'
});
ck('规范处方仍判合理', rOk.verdict === 'reasonable' && rOk.score === 100, rOk.summary);
// ⑧ 每日剂数解析
ck('每日剂数解析', RX.pickDailyJi('每日2剂 水煎服') === 2 && RX.pickDailyJi('每日1剂') === 1 && RX.pickDailyJi('') === 1);

const pass = okList.filter(x => x[1]).length;
console.log(`\n${pass}/${okList.length}  ${pass === okList.length ? 'RXRULE_TEST_OK' : 'RXRULE_TEST_FAIL'}`);
process.exit(pass === okList.length ? 0 : 1);
