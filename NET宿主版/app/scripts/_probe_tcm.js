// scripts/_probe_tcm.js - 批次 2 对拍基线（辨证处方引擎 / 文本分析 / 合规）
//
// 用法: node scripts/_probe_tcm.js > /tmp/js.txt
// 对拍: QhjfCapture.exe --probe-tcm > /tmp/cs.txt ; node scripts/_diff_tcm.js /tmp/js.txt /tmp/cs.txt
//
// 输出格式：每行 `NAME\t<JSON>`。两侧同一组场景逐项比对，证明 C# 复刻零漂移。
'use strict';
const path = require('path');

const USER_DATA = process.env.QHJF_USERDATA ||
  path.join(process.env.APPDATA || '', '岐黄鉴方·悬浮采集助手');

const DB = require('../lib/db');
DB.initDb(USER_DATA);

const KB = require('../lib/kb');
const userKb = require('../lib/userkb').initUserKb(USER_DATA);
const clinicalKbMod = require('../lib/clinicalkb');
const clinicalKb = clinicalKbMod.initClinicalKb(USER_DATA);
const { KIND_DIAG, KIND_SX, KIND_WESTMAP } = clinicalKbMod;

const TCM = require('../lib/tcm');
const Analyze = require('../lib/analyze');
const Compliance = require('../lib/compliance');

// 运行时注入（对齐 main.js 启动顺序）
TCM.setYibaoRules(userKb.ybList());
TCM.setWestMap(clinicalKb.list(KIND_WESTMAP));

const diagNames = clinicalKb.list(KIND_DIAG).map(d => d && d.name).filter(Boolean);
const syndromeRows = clinicalKb.syndromeRows().map(r => r && r.name).filter(Boolean);

/** 构造 OCR 纠错术语库（逐字复刻 main.js finalizeRecord 内联逻辑） */
function buildMedTerms(rawText) {
  const diags = clinicalKb.list(KIND_DIAG).map(d => d && d.name).filter(Boolean);
  const syndCtx = [];
  const syndSupport = {};
  const bump = (n) => { if (typeof n === 'string' && n) syndSupport[n] = (syndSupport[n] || 0) + 1; };
  for (const d of clinicalKb.list(KIND_DIAG)) {
    if (d && d.name && rawText && rawText.includes(d.name)) {
      (d.syndromes || []).forEach(s => { const n = typeof s === 'string' ? s : (s && s.name); if (n) syndCtx.push(n); });
    }
    (d.syndromes || []).forEach(s => bump(typeof s === 'string' ? s : (s && s.name)));
  }
  for (const s of clinicalKb.list(KIND_SX)) ((s && s.syndromes) || []).forEach(x => bump(typeof x === 'string' ? x : (x && x.name)));
  return { syndromes: syndromeRows, diags, syndCtx: [...new Set(syndCtx)], syndSupport };
}

const S = [];
const emit = (name, value) => S.push(name + '\t' + JSON.stringify(value));

// ==================== ① fixOcrText（三层） ====================
const ocrCases = [
  '臼术12g 白勺10g 川穹6g',
  '白 花 蛇 舌 草 30g',
  '炙 甘草 6g',
  '创伤病 气血瘀证 西医诊断',
  '制 吴 萸 12g',
  '党参12g\n茯苓9g\n炙苜草 45g',
  '苍术 10g\n莪术 9g\n灸甘草 8g',
  '诊断为创伤病 气滞血瘀证',
  '髋部叶损伤 射挫伤 损伍',
  '炒六祺曲 15g',
  '太子 0 参 12g',
  '白莹 12g',
  '炒莱菔子 10g 麸炒白术 12g',
];
emit('ocr_cases', ocrCases.map(t => KB.fixOcrText(t).text));
emit('ocr_fixes', ocrCases.map(t => KB.fixOcrText(t).fixes));
// 带术语库（证型/诊断约束纠错）
const medSample = '中医诊断：创伤病\n气滞血瘀证\n主诉：右腕肿痛。';
const mt = buildMedTerms(medSample);
emit('ocr_terms_meta', { syndromes: mt.syndromes.length, diags: mt.diags.length, syndCtx: mt.syndCtx.length, supKeys: Object.keys(mt.syndSupport).length });
emit('ocr_terms_text', KB.fixOcrText(medSample, mt).text);
emit('ocr_terms_alt', KB.fixOcrText('辨证：气滞血瘀证', mt).text);

// ==================== ② 文本归一化与脱敏 ====================
emit('norm_ocr', [
  Analyze.maskText('患者姓名：张三  住院号：ZY2026001234  手机号：13812345678  身份证：110101199003071234'),
  Analyze.maskText('党 参 12 克\n白 术 9克'),
  Analyze.maskText('４．５克 ＡＢＣ'),
  Analyze.maskText('创伤病 气滞血瘀证', { keepSpaces: true }),
]);

// ==================== ③ 分块 / 要素 / 竖排合并 ====================
const secText = [
  '主诉：右腕肿痛活动受限3天',
  '现病史：患者3天前摔伤致右腕肿痛',
  '舌红 苔薄白',
  '脉弦涩',
  '中医诊断：骨折病',
  '气滞血瘀证',
  '治法：活血化瘀，行气止痛',
  '方药：桃红四物汤加减',
  '桃仁 9g',
  '红花 6g',
  '川芎 9g',
  '当归 12g',
].join('\n');
emit('analyze_sections', Analyze.splitIntoSections(secText));
emit('analyze_keys', Analyze.extractKeyPoints(secText));
emit('analyze_keys2', Analyze.extractKeyPoints('中医诊断：创伤病 气滞血瘀证\n西医诊断：1.肘挫伤 2.髋部损伤'));
// 「临床诊断及证型」混排一行（真实 HIS 截图）：病名与证型逗号分隔
emit('analyze_keys3', Analyze.extractKeyPoints('临床诊断及证型：乳腺肿块,多汗疖,乳岩,汗病,痰瘀阳络证,浸热\nR\n'));
emit('analyze_keys4', Analyze.extractKeyPoints('中医诊断及证型：创伤病,气滞血瘀证\n治法：活血化瘀'));
emit('analyze_merge', Analyze.mergeDoseLines('太子参\n15g\n姜厚朴\n12g\n炒六神曲\n甘草\n生麦芽 10g\n12g\n12g'));
// 处方「用法」抓取：带标签 / 无标签片段 / 药味行不吃 / 纯药味行不产用法
emit('analyze_usage', [
  '黄芪 30g\n白术 12g\n用法：水煎服，每日1剂，分2次温服',
  '黄芪 30g 水煎服，每日1剂',
  '用法用量: 水煎 400ml，分早晚两次温服',
  '外用，每日2次',
  '用法\n水煎服，日1剂\n中医诊断：骨折病',
  'sig: po tid',
  '太子参 15g\n姜厚朴 12g',
  '用法：',
  '每日1剂\n免煎免煎\n外用',
  '冲服\n每日2次\n外用',
].map(t => (Analyze.pickUsage(t) || {}).usage || ''));
emit('analyze_usage_tcm', (() => {
  const r = TCM.runTcm({ text: '处方：\n黄芪 30g\n白术 12g\n用法：水煎服，每日1剂，分2次温服', keys: {}, sections: [], diagSynds: [] });
  return { usage: r.usage || '', herbs: r.herbs || [] };
})());
// 外用豁免内服常用量核查（真实场景：栀子 30g 外用）：外用 → 不逐味告警、合并一条 info；内服 → 照旧 warn
emit('analyze_usage_external', (() => {
  const text = '姜黄 30g\n羌活 30g\n干姜 30g\n炒栀子 30g\n醋乳香 3g\n醋没药 3g';
  const mk = (usage) => {
    const r = TCM.runTcm({ text, keys: {}, sections: [], diagSynds: [], usage });
    const items = ((r.rx && r.rx.items) || []).filter(i => i.cat === '用量核查')
      .map(i => ({ level: i.level, tag: i.tag || '', title: i.title || '' }));
    return { usage: r.usage || '', items };
  };
  return { ext: mk('外用，每日2次'), oral: mk('') };
})());
emit('analyze_usage_isext', ['外用', '水煎外洗患处', '水煎服，每日1剂', '贴敷患处', ''].map(u => Analyze.isExternalUsage(u)));
// 剂量误读修复（linesToText 前置）：tiny 档把「12g」误读成纯数字「128」（g→8），
// 纯数字行随后被噪声过滤整行删除 → 剂量凭空丢失。有坐标时须位于药名右侧同行才按剂量解读；
// 行号在药名左侧（x=8）保持原样被删；无坐标竖排（药名⏎纯数字）按剂量并回。
const cap = require('../lib/capture');
emit('ocr_ltt_misread', cap.linesToText([
  { text: '桔梗', x: 20.0, y: 68.0 },
  { text: '12g', x: 153.0, y: 70.0 },
  { text: '法半夏', x: 195.0, y: 68.0 },
  { text: '128', x: 324.0, y: 67.0 },
  { text: '浙贝母', x: 367.0, y: 68.0 },
  { text: '128', x: 496.0, y: 69.0 },
  { text: '21', x: 8.0, y: 68.0 },
]));
emit('ocr_ltt_vert', cap.linesToText([{ text: '法半夏' }, { text: '12' }]));
emit('ocr_ltt_noise', cap.linesToText([{ text: '黄芪 30g' }, { text: '21' }]));
emit('analyze_classify', [
  'tid 1片 口服',
  '黄芪 30g',
  '主诉：咳嗽3天',
  '白花蛇舌草 12g',
  '规格',
  '15g',
  '长期医嘱',
].map(l => { const c = Analyze.classifyLine(l); return [l, c.type, c.score, c.strong]; }));

// ==================== ④ runTcm 场景 ====================
const scenarios = [
  ['sijunzi', '党参12g、白术9g、茯苓9g、炙甘草6g', {}],
  ['ocr_overdose', '党参12g\n茯苓9g\n炙苜草 45g', {}],
  ['clean', '甘草 6g\n茯苓 12g', {}],
  ['fuzzy', '党参12g\n茯苓9g\n臼术 45g', {}],
  ['jiu_zhi', '苍术 10g\n莪术 9g\n灸甘草 8g', {}],
  ['record_fit', '中医诊断：咳嗽病\n证型：风热犯肺证\n麻黄6g 苦杏仁9g 石膏15g 甘草6g', { 中医诊断: '咳嗽病', 证型: '风热犯肺证' }],
  ['cross_domain', '中医诊断：骨折病\n证型：气滞血瘀证\n速效救心丸 川芎10g 丹参15g', { 中医诊断: '骨折病', 证型: '气滞血瘀证' }],
  ['diag_only', '中医诊断：咳嗽\n主诉：咳嗽3天，痰白清稀。', { 中医诊断: '咳嗽' }, ['风寒袭肺证', '风热犯肺证', '风燥伤肺证', '痰湿蕴肺证', '痰热郁肺证', '肝火犯肺证', '肺阴亏耗证']],
  ['trauma', '中医诊断：骨折\n辨证：气滞血瘀证\n主诉：右腕肿痛活动受限。', { 中医诊断: '骨折', 证型: '气滞血瘀证' }, ['气滞血瘀']],
  ['plain2', '当归 12g\n黄芪 15g', {}],
  ['badpair', '附子 6g\n浙贝母 12g', {}],
  ['xiaoqinglong', '麻黄 9g 桂枝 9g 干姜 9g 细辛 3g 五味子 6g 白芍 9g 半夏 9g 炙甘草 6g', {}],
  ['formula_name', '方药：小青龙汤加减\n麻黄9g 桂枝9g 干姜9g 细辛3g 五味子6g', {}],
  ['single', '太子参15g 水煎服', {}],
  ['pregnancy', '孕妇 当归12g 桃仁9g 红花6g', {}],
  ['west_drug', '阿司匹林 丹参15g 川芎10g', {}],
  ['raw_toxic', '生半夏 9g 附子 6g', {}],
  ['count_mismatch', '每剂含 12 味\n黄芪 30g 当归 12g 川芎 9g', {}],
  ['truncated', '中医诊断：咳嗽病，证型：风热犯肺证，', {}],
  ['unknown_herb', '穿山甲 9g 王不留行 12g', {}],
  // 别名/炮制品用量核查口径（北柴胡/姜厚朴 非错字，2026-10-15）：规格→规格话术、炮制→炮制话术
  ['alias_spec', '北柴胡 12g\n南柴胡 9g\n川厚朴 12g', {}],
  ['alias_processed', '姜厚朴 15g\n法半夏 12g\n酒大黄 20g', {}],
  // 2026-10-15 禁忌库全面扩充：中西药相互作用 7 类 + 毒性叠加 5 类 + 妊娠表扩充
  ['itx_bleed', '患者长期服用华法林\n中医处方：丹参15g 川芎10g 当归12g', {}],
  ['itx_digoxin', '地高辛0.125mg\n处方：炙甘草10g 茯苓12g', {}],
  ['itx_aconite', '地高辛0.125mg qd\n处方：制附子10g 干姜6g 甘草6g', {}],
  ['itx_purgative', '呋塞米20mg\n处方：大黄10g 芒硝6g', {}],
  ['itx_glucose', '二甲双胍0.5g tid\n处方：黄芪30g 葛根15g 天花粉12g', {}],
  ['itx_ephedra', '氨氯地平5mg qd\n处方：麻黄9g 苦杏仁9g 甘草6g', {}],
  ['itx_liver', '阿托伐他汀20mg qn\n处方：柴胡12g 黄芩9g', {}],
  ['stack_aconite', '制附子10g 草乌3g 干姜6g', {}],
  ['stack_drastic', '甘遂1g 大戟2g 大枣10g', {}],
  ['stack_blood3', '水蛭3g 三棱9g 莪术9g 当归12g', {}],
  ['stack_mineral', '朱砂0.3g 茯苓12g', {}],
  ['stack_narcosis', '罂粟壳6g 洋金花0.3g', {}],
  ['preg_ext', '孕妇慎用：番泻叶6g 芦荟3g 麝香0.1g 三七6g', {}],
  ['preg_caut', '孕妇：三七6g 蒲黄9g 王不留行12g 牡丹皮9g', {}],
];
for (const [name, text, keys, dg] of scenarios) {
  const r = TCM.runTcm({ text, keys: keys || {}, sections: [], diagSynds: dg || [] });
  // 全量比对（含 rx.items / recs / chosen / herbCards），只把 disclaimer 抽出来单独比一次
  const clone = JSON.parse(JSON.stringify(r));
  delete clone.disclaimer;
  emit('tcm_' + name, clone);
}
emit('tcm_disclaimer', TCM.runTcm({ text: '当归 12g', keys: {} }).disclaimer);

// ==================== ⑤ 西医诊断 → 中医诊断候选 ====================
emit('west_bone', TCM.westTcmCandidates('桡骨干骨折', diagNames));
emit('west_tnb', TCM.westTcmCandidates('2型糖尿病', diagNames));
emit('west_xjt', TCM.westTcmCandidates('心绞痛', diagNames));
emit('west_face', TCM.westTcmCandidates('面神经炎', diagNames));
emit('west_pd', TCM.westTcmCandidates('帕金森病', diagNames));
emit('west_py_tnb', TCM.westTcmCandidates('tnb', diagNames));
emit('west_py_gxy', TCM.westTcmCandidates('gxy', diagNames));
emit('west_py_gxb', TCM.westTcmCandidates('gxb', diagNames));
emit('west_meta', { diagNames: diagNames.length, syndromes: syndromeRows.length, westMap: clinicalKb.list(KIND_WESTMAP).length });

// ==================== ⑥ 合规引擎 ====================
emit('compliance_none', Compliance.runCompliance({ text: '当归 12g 黄芪 15g', keys: {} }));
emit('compliance_full', Compliance.runCompliance({
  text: secText, keys: { 主诉: '右腕肿痛活动受限3天', 中医诊断: '骨折病', 证型: '气滞血瘀证', 治法: '活血化瘀，行气止痛' },
}));
emit('compliance_bad', Compliance.runCompliance({
  text: '患者：张三\n主诉：因头晕1月\n辨证：气血两虚\n治法：活血化瘀\n未记录舌脉', keys: {},
}));

// 供脚本侧自查
if (process.env.QHJF_PROBE_META === '1') {
  console.error('diagNames=' + diagNames.length + ' syndromes=' + syndromeRows.length);
}
process.stdout.write(S.join('\n') + '\n');
