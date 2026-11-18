// scripts/_seed_demo_rx.js —— 预置 HIS 演示处方（用于截图演示）
//   ① 十八反 / 十九畏配伍禁忌   ② 医保违规（自费/限定支付/贵细）
//   ③ 点评红线（大处方/超剂量/超疗程/方证不符）
// 用法：
//   node scripts/_seed_demo_rx.js            # dry-run：只打印分析结果，不落库
//   node scripts/_seed_demo_rx.js --write    # 写入 data.db（demo:true，可被 --clear-records 清除）
//   node scripts/_seed_demo_rx.js --clean    # 只清理本脚本预置的记录（按 data.demoTag='his-demo'）
const path = require('path');
const UD = String(process.env.QHJF_USERDATA || '').trim()
  || path.join(process.env.APPDATA, '岐黄鉴方·悬浮采集助手');

const DB = require('../lib/db');
DB.initDb(UD);
const { initStore } = require('../lib/store');
const { initUserKb } = require('../lib/userkb');
const analyze = require('../lib/analyze');
const { runTcm } = require('../lib/tcm');
const { runCompliance } = require('../lib/compliance');
const rxqc = require('../lib/rxqc');
const rxreview = require('../lib/rxreview');

const store = initStore(UD);
try { initUserKb(UD); } catch (e) { console.warn('[seed] 用户知识库初始化失败：' + e.message); }

const DEMOS = [
  {
    key: 'shibafan',
    dept: '脾胃病科', patient: '孙某某', diag: '胃脘痛', synd: '脾胃虚寒证',
    title: '门诊医生工作站',
    raw: [
      '门诊病历',
      '姓名：孙某某  性别：男  年龄：56岁',
      '科别：脾胃病科',
      '主诉：胃脘冷痛反复1年，加重3天。',
      '现病史：患者1年来胃脘冷痛，喜温喜按，遇寒加重，得温则减，伴畏寒肢冷、纳差便溏。近3天因受凉症状加重，遂来就诊。',
      '既往史：慢性胃炎病史5年，否认高血压、糖尿病。',
      '查体：腹软，中上腹轻压痛，舌淡苔白滑，脉沉迟。',
      '中医诊断：胃脘痛',
      '证型：脾胃虚寒证',
      '治法：温中健脾，散寒止痛',
      'Rp：',
      '制附子 10g（先煎） 法半夏 9g 炙甘草 10g 海藻 10g',
      '人参 9g 五灵脂 10g 干姜 6g 白术 12g',
      '7剂，水煎服，日一剂，分两次温服'
    ].join('\n')
  },
  {
    key: 'yibao',
    dept: '妇科', patient: '周某某', diag: '月经不调', synd: '气血两虚证',
    title: 'HIS 处方录入',
    raw: [
      '门诊病历',
      '姓名：周某某  性别：女  年龄：62岁',
      '科别：妇科',
      '主诉：月经量少、色淡反复半年。',
      '现病史：患者半年来月经量少色淡，周期延后，伴面色萎黄、头晕乏力、心悸失眠，纳可，二便调。',
      '既往史：否认高血压、糖尿病，否认药物过敏史。',
      '查体：舌淡苔薄白，脉细弱。',
      '中医诊断：月经不调',
      '证型：气血两虚证',
      '治法：益气养血，调补冲任',
      'Rp：',
      '阿胶 10g 鹿茸 3g 冬虫夏草 3g 西洋参 6g',
      '黄芪 30g 当归 12g 熟地黄 15g 白芍 12g 川芎 9g',
      '7剂，水煎服，日一剂，分两次温服'
    ].join('\n')
  },
  {
    key: 'redline',
    dept: '心病科', patient: '郑某某', diag: '胸痹', synd: '心血瘀阻证',
    title: 'HIS 处方录入',
    raw: [
      '门诊病历',
      '姓名：郑某某  性别：男  年龄：48岁',
      '科别：心病科',
      '主诉：胸闷胸痛反复2年，加重1周。',
      '现病史：患者2年来反复胸闷胸痛，痛处固定，劳累后加重，休息可缓解，伴心悸气短。近1周发作频繁，遂来就诊。',
      '既往史：高血压病史8年，吸烟史20年。',
      '查体：舌暗红苔白，脉弦涩。',
      '中医诊断：胸痹',
      '证型：心血瘀阻证',
      '治法：活血化瘀，通脉止痛',
      'Rp：',
      '石膏 150g 知母 15g 黄连 12g 黄芩 12g 黄柏 12g',
      '栀子 12g 金银花 15g 连翘 15g 蒲公英 20g 板蓝根 15g',
      '大青叶 15g 生地黄 15g 玄参 15g 牡丹皮 12g 赤芍 12g',
      '紫花地丁 15g 野菊花 12g 鱼腥草 20g 败酱草 15g 白花蛇舌草 20g',
      '苦参 12g 白鲜皮 12g 山慈菇 9g 夏枯草 12g 浙贝母 12g',
      '桔梗 9g 牛蒡子 12g 薄荷 6g 甘草 6g 芦根 20g',
      '20剂，水煎服，日一剂，分两次温服'
    ].join('\n')
  }
];

// 与 main.js analyzeRecord 同源的分析组合（诊断/证型直接进 keys）
function analyzeDemo(raw, diag, synd) {
  const text = analyze.maskText ? analyze.maskText(raw) : raw;
  let sections = [];
  try { sections = analyze.splitIntoSections(text, {}); } catch (e) { /* 分块失败不阻断 */ }
  const keys = {};
  if (diag) keys['中医诊断'] = diag;
  if (synd) keys['证型'] = synd;
  const usage = String((analyze.pickUsage(text) || {}).usage || '');
  const compliance = runCompliance({ text, keys, sections });
  const tcm = runTcm({ text, keys, sections, usage });
  const qc = rxqc.check({ text, tcm, usage: usage || (tcm && tcm.usage) || '' });
  return { text, sections, keys, usage, compliance, tcm, qc };
}

const mode = process.argv.includes('--write') ? 'write'
  : (process.argv.includes('--clean') ? 'clean' : 'dry');

if (mode === 'clean') {
  let n = 0;
  for (const r of store.list()) {
    if (r && r.demoTag === 'his-demo') { store.remove(r.id); n++; }
  }
  console.log('[seed] 已清理演示记录 ' + n + ' 条');
  process.exit(0);
}

if (mode === 'write') {
  // 幂等：先清掉上一批本脚本预置的演示记录（只认 demoTag，不动手工采集与其他演示数据）
  let replaced = 0;
  for (const r of store.list()) if (r && r.demoTag === 'his-demo') { store.remove(r.id); replaced++; }
  console.log('[seed] 清理旧演示记录 ' + replaced + ' 条');
}

const now = Date.now();
DEMOS.forEach((d, i) => {
  const a = analyzeDemo(d.raw, d.diag, d.synd);
  const herbs = (a.tcm && a.tcm.herbs) || [];
  const doses = (a.tcm && a.tcm.herbDoses) || {};
  const comp = ((a.compliance && a.compliance.items) || []);
  const qcItems = (a.qc && a.qc.items) || [];
  const review = rxreview.reviewOne({ tcm: a.tcm, text: a.text, diag: d.diag, synd: d.synd, usage: a.usage });

  console.log('\n================ ' + d.key + ' · ' + d.dept + ' · ' + d.diag + (d.synd ? '（' + d.synd + '）' : ''));
  console.log('药味 %d 味，带剂量 %d 味，用法：%s', herbs.length, Object.keys(doses).length, a.usage || '（未识别）');
  console.log('药味：' + herbs.map(h => h + (doses[h] ? doses[h].val + doses[h].unit : '') ).join(' '));
  console.log('--- 审方建议（面板「合规建议」）');
  comp.forEach(it => console.log(`  [${it.level}] ${it.cat}${it.tag ? '/' + it.tag : ''}：${it.title}`));
  if (!comp.length) console.log('  （无）');
  const rxItems = (a.tcm && a.tcm.rx && a.tcm.rx.items) || [];
  console.log('--- 处方审方（tcm.rx.items，含配伍禁忌/医保提示）');
  rxItems.forEach(it => console.log(`  [${it.level}] ${it.cat}${it.tag ? '/' + it.tag : ''}：${it.title}`));
  if (!rxItems.length) console.log('  （无）');
  if (a.tcm && a.tcm.diagCheck) console.log(`--- 方证相符率：${Math.round((a.tcm.diagCheck.ratio || 0) * 100)}%（${a.tcm.diagCheck.supN}/${a.tcm.diagCheck.totN}）`);
  console.log('--- 识别质检 qc：错误 %d / 提醒 %d', qcItems.filter(x => x.level === 'error').length, qcItems.filter(x => x.level === 'warn').length);
  qcItems.slice(0, 8).forEach(it => console.log(`  [${it.level}] ${it.name}：${(it.issues || []).map(x => x.label).join('/')}`));
  console.log('--- 后台点评');
  if (!review.ok) console.log('  点评失败：' + review.error);
  else {
    console.log('  ' + review.verdictLabel + '  评分 ' + review.score + '  ' + review.summary);
    review.items.filter(x => x.cls !== 'note').forEach(it => console.log(`  [${it.level}] ${it.clsLabel}/${it.tag}：${it.title}`));
  }

  if (mode === 'write') {
    const rec = store.add({
      source: 'region', winTitle: d.title || '', text: a.text, rawText: d.raw,
      sections: a.sections, ts: new Date(now - (DEMOS.length - i) * 60000).toISOString(),
      patient: d.patient, diag: d.diag, synd: d.synd, dept: d.dept,
      demo: true, demoTag: 'his-demo'
    });
    store.patch(rec.id, {
      keys: a.keys, usage: a.usage, compliance: a.compliance, tcm: a.tcm, qc: a.qc,
      analyzedAt: new Date().toISOString(), demoTag: 'his-demo'
    });
    console.log('  → 已写入 ' + rec.id.slice(0, 8));
  }
});

console.log('\n' + (mode === 'write' ? '[seed] 写入完成，可在记录列表查看（源=框选，demo 标记）'
  : '[seed] dry-run 结束；加 --write 落库'));
