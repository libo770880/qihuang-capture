// scripts/_probe_chan.js - 批次 2 通道级对拍基线
//
// 用法: node scripts/_probe_chan.js > .probe/js_chan.txt
// 对拍: QhjfCapture.exe --probe-chan > .probe/cs_chan.txt
//       node scripts/_diff_tcm.js .probe/js_chan.txt .probe/cs_chan.txt
//
// 说明：链路依赖 Electron 的 ipcMain/store，这里用真实的 lib/db + lib/store 跑
//       main.js 中同名处理器的**同源实现**（逐字照抄，含注释），只把 e/store 依赖换成直接调用。
//       输出格式与 C# --probe-chan 一致：每行 `NAME\tJSON`。
'use strict';
const path = require('path');

// 数据目录：默认生产目录（对拍基线依赖真实库内容）。
// 需要跑独立目录时用：QHJF_USERDATA=<目录> node scripts/_probe_chan.js
// ⚠ 探针会写 kv.ai（测试配置），必须保证跑完原样还原——见下方"配置"段的还原顺序注释。
const USER_DATA = process.env.QHJF_USERDATA ||
  path.join(process.env.APPDATA || '', '岐黄鉴方·悬浮采集助手');

const DB = require('../lib/db');
DB.initDb(USER_DATA);
const store = require('../lib/store').initStore(USER_DATA);

const TCM = require('../lib/tcm');
const Analyze = require('../lib/analyze');
const Compliance = require('../lib/compliance');
const KB = require('../lib/kb');
const userKb = require('../lib/userkb').initUserKb(USER_DATA);
const clinicalKbMod = require('../lib/clinicalkb');
const clinicalKb = clinicalKbMod.initClinicalKb(USER_DATA);
const { KIND_DIAG, KIND_SX, KIND_WESTMAP } = clinicalKbMod;
const { westTcmCandidates } = require('../lib/tcm');
const rxqc = require('../lib/rxqc');

// 运行时注入（对齐 main.js 启动时的 setYibaoRules / setWestMap）
// 注：用户库并入内置视图由 userkb.initUserKb 内部完成（KB.setUserData/setOcrFixes），此处无需重复。
TCM.setYibaoRules(userKb.ybList ? userKb.ybList() : []);
TCM.setWestMap(clinicalKb.list(KIND_WESTMAP));

const TEMP_ID = '__probe_chan__';

// ---- main.js usageForPatch（逐字照抄）：手填过以手填为准，否则用 tcm 抓取值；tcm 缺失时从文本抓取 ----
function usageForPatch(rec, tcm) {
  if (rec && rec.usageEdited) return String(rec.usage || '');
  const u = String((tcm && tcm.usage) || '').trim();
  if (u) return u;
  try { return String((Analyze.pickUsage((rec && (rec.text || rec.rawText)) || '') || {}).usage || ''); } catch (e) { return ''; }
}

// ---- main.js:737 analyzeRecord（逐字照抄，clinicalKb 由模块级变量提供） ----
function analyzeRecord(rec, over = {}) {
  const keys = Object.assign({}, rec.keys || {});
  if (over && over.synd) keys['证型'] = String(over.synd);
  if (over && over.diag) keys['中医诊断'] = String(over.diag);
  let diagSynds = [];
  try {
    const dn = String((over && over.diag) || keys['中医诊断'] || '').trim();
    if (dn && clinicalKb) {
      const d = clinicalKb.list(KIND_DIAG).find(x => x && x.name && (x.name === dn || dn.includes(x.name) || x.name.includes(dn)));
      if (d) diagSynds = (d.syndromes || []).map(s => typeof s === 'string' ? s : (s && s.name) || '').filter(Boolean);
    }
  } catch (e) { /* 忽略 */ }
  const compliance = Compliance.runCompliance({ text: rec.text || '', keys, sections: rec.sections || [] });
  // 用法参与分析（逐字镜像 main.js analyzeRecord）：手填（usageEdited）优先，否则用文本抓取值
  let usageCtx = '';
  try { usageCtx = usageForPatch(rec, { usage: (Analyze.pickUsage(rec.text || '') || {}).usage || '' }); } catch (e) { usageCtx = ''; }
  const tcm = TCM.runTcm({ text: rec.text || '', keys, sections: rec.sections || [], diagSynds, usage: usageCtx });
  return { compliance, tcm, keys };
}

// ---- main.js:1173 handler: record:addRx ----
function hAddRx({ id, rxText } = {}) {
  const rec = id ? store.get(id) : null;
  const add = String(rxText || '').trim();
  if (!rec) return { ok: false, error: '记录不存在' };
  if (!add) return { ok: false, error: '处方内容为空' };
  const marker = '\n【补录方剂】\n';
  const rawText2 = (rec.rawText || rec.text || '') + marker + add;
  const text2 = (rec.text || '') + marker + (Analyze.maskText ? Analyze.maskText(add) : add);
  const updated = { ...rec, text: text2, rawText: rawText2 };
  let compliance = rec.compliance, tcm = rec.tcm;
  try { const an = analyzeRecord(updated); compliance = an.compliance; tcm = an.tcm; } catch (err) { /* 保留原分析 */ }
  const u2 = usageForPatch(rec, tcm);
  const patched = store.patch(id, { text: text2, rawText: rawText2, compliance, tcm, usage: u2,
    qc: rxqc.check({ text: text2, tcm, usage: u2 }), rxAddedAt: new Date().toISOString() });
  return { ok: true, rec: patched };
}

// ---- main.js:1190 handler: record:setRx ----
function hSetRx({ id, text, usage: usageArg } = {}) {
  const rec = id ? store.get(id) : null;
  const t2 = String(text || '').trim();
  if (!rec) return { ok: false, error: '记录不存在' };
  if (!t2) return { ok: false, error: '内容不能为空' };
  const rawText2 = t2;
  const text2 = Analyze.maskText ? Analyze.maskText(t2) : t2;
  let sections = rec.sections;
  try { sections = Analyze.splitIntoSections(text2, {}); } catch (err) { /* 沿用原分块 */ }
  const updated = { ...rec, text: text2, rawText: rawText2, sections };
  let compliance = rec.compliance, tcm = rec.tcm;
  try { const an = analyzeRecord(updated); compliance = an.compliance; tcm = an.tcm; } catch (err) { /* 保留原分析 */ }
  const usageHand = String(usageArg || '').trim();
  const uRx = usageHand || usageForPatch(rec, tcm);
  const rxPatch = { text: text2, rawText: rawText2, sections, compliance, tcm,
    usage: uRx, qc: rxqc.check({ text: text2, tcm, usage: uRx }), editedAt: new Date().toISOString() };
  if (usageHand) rxPatch.usageEdited = true;
  const patched = store.patch(id, rxPatch);
  return { ok: true, rec: patched };
}

// ---- main.js:1678 handler: kb:sbf-list（内置歌诀规则 + 规则总览 meta）----
function hSbfList() {
  const d = userKb ? userKb.sbfList() : { builtin: [], user: [] };
  return {
    builtin: d.builtin,
    userN: (d.user || []).length,
    // meta 里的计数与清单必须两侧完全一致（2026-10-15 禁忌库扩充后新增）
    meta: d.meta || null,
  };
}

// ---- main.js:1207 handler: record:analyze ----
function hAnalyze({ id, diag, synd, force, reason } = {}) {
  const rec = id ? store.get(id) : null;
  if (!rec) return { ok: false, error: '记录不存在' };
  // 识别质检拦截（与 main.js record:analyze 一致）：error 级问题未修正前拒绝分析，force=1 放行
  const qcPre = rxqc.check({ text: rec.text, tcm: rec.tcm, usage: rec.usage || (rec.tcm && rec.tcm.usage) });
  if (qcPre.block && !force) {
    return { ok: false, blocked: true, needForce: true, qc: qcPre, error: rxqc.blockMsg(qcPre) };
  }
  const { compliance, tcm } = analyzeRecord(rec, { diag, synd });
  const qc = rxqc.check({ text: rec.text, tcm, usage: usageForPatch(rec, tcm) || rec.usage });
  // 强制放行留痕：理由写入 qc.forced（与 main.js 同构；at 时间戳两侧必然不同，对拍场景只取摘要）
  const reasonTxt = String(reason || '').trim().slice(0, 200);
  if (force && reasonTxt) qc.forced = { at: new Date().toISOString(), reason: reasonTxt };
  store.patch(id, { compliance, tcm, qc, diag: diag || '', synd: synd || '',
    usage: usageForPatch(rec, tcm), analyzedAt: new Date().toISOString() });
  const focusN = (compliance && (compliance.errorN || 0) + (compliance.warnN || 0)) || 0;
  return {
    ok: true,
    compliance,
    tcm,
    qc,
    focusN,
    hasRecord: !!(compliance && compliance.hasRecord),
    tcmOk: !!(tcm && tcm.ok),
    msg: [tcm && tcm.ok && tcm.type !== 'none' ? tcm.msg : '',
          compliance && compliance.hasRecord ? focusN + ' 条合规建议' : ''].filter(Boolean).join('；')
  };
}

// ---- main.js:1755 handler: tcm:west-candidates ----
function hWestCandidates(west) {
  const names = clinicalKb ? clinicalKb.list(KIND_DIAG).map(d => d.name) : [];
  return westTcmCandidates(west, names);
}

// ---- main.js:1758 handler: kb:consult-data ----
function hConsultData() {
  if (!clinicalKb || !KB) return { diagnoses: [], symptoms: [], formulas: [] };
  const { list, syndromeRows } = clinicalKb;
  return {
    diagnoses: list(KIND_DIAG),
    symptoms: list(KIND_SX),
    syndromeRows: syndromeRows(),
    formulas: KB.getAllFormulas().map(f => ({ n: f.n, k: f.k || 'f', s: f.s || [], c: f.c, g: f.g, m: f.m, u: f.u, origin: f.origin, x: f.x || '' }))
  };
}

// ==================== 与 C# --probe-chan 同一组场景，同一顺序 ====================

const SEED_TEXT =
  '主诉：咳嗽咳痰3天。\n' +
  '中医诊断：风热犯肺证\n' +
  '西医诊断：急性支气管炎\n' +
  '处方：\n' +
  '麻黄 9克\n' +
  '桂枝 6克\n' +
  '苦杏仁 9克\n' +
  '炙甘草 6克\n' +
  '附子 15克\n' +
  '法半夏 9克\n' +
  '黄芩 12克\n';

const seed = () => ({
  id: TEMP_ID,
  ts: '2026-01-01T00:00:00.000Z',
  source: 'probe',
  text: SEED_TEXT,
  rawText: SEED_TEXT,
  keys: {
    '就诊时间': '2026-01-01 09:00',
    '姓名': '张三',
    '手机号': '13812345678',
    '中医诊断': '风热犯肺证',
  },
  sections: [],
});

// 时间戳遮罩：键名为 ts 或以 At 结尾时，把数字换成 #（与 C# Mask 对齐）
// `at` 单列进来：人工复核裁定的落库键就叫 at，而 /At$/ 是大小写敏感的，
// 不单列会被当成普通字符串逐字对比（跨运行时时间戳必然不等）——对拍会假报差异。
const isTsKey = (k) => k === 'ts' || k === 'at' || /At$/.test(k);
const scrub = (s) => String(s).replace(/[0-9]/g, '#');

// 传输层错误遮罩：'无法连接模型服务：<尾巴>' 的尾巴由运行时网络栈决定
// （Node undici **不读** HTTP_PROXY，.NET HttpClient **会读** —— 本机有代理时
//   一侧报 "fetch failed"、另一侧报 proxy 502，属环境噪声而非业务差异）。
// 只保留业务侧自己写的固定前缀（前缀在说明 ai.js 确实做了包裹），尾巴统一换 <net>。
// 与 C# 侧 MaskNetText 同源同规则。
const NET_PREFIX = '无法连接模型服务：';
const maskNetText = (s) => (s.indexOf(NET_PREFIX) === 0 ? NET_PREFIX + '<net>' : s);

function mask(v) {
  if (typeof v === 'string') return maskNetText(v);
  if (Array.isArray(v)) return v.map(mask);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) {
      o[k] = (isTsKey(k) && typeof v[k] === 'string') ? scrub(v[k]) : mask(v[k]);
    }
    return o;
  }
  return v;
}

const out = [];
const emit = (name, v) => out.push(name + '\t' + JSON.stringify(mask(v === undefined ? null : v)));

// 注意：批次 5 的 AI 通道是异步的，而本文件是 CommonJS（require）。
//       Node 一旦在模块顶层看到 await 就会按 ESM 解析并与 require 冲突
//       （ERR_AMBIGUOUS_MODULE_SYNTAX），所以整段探针必须包进 async IIFE。
(async () => {
// AI 配置原始值：配置场景会写入测试配置，必须在全部场景跑完后（末尾 finally）原样还原。
// 声明在 try 顶层——配置场景在嵌套块里，块内局部变量末尾取不到。
let savedAi;
try {
  store.remove(TEMP_ID);
  store.add(seed());

  emit('chan_west_known', hWestCandidates('急性支气管炎'));
  emit('chan_west_unknown', hWestCandidates('完全不存在的病名XYZ'));
  emit('chan_west_empty', hWestCandidates(''));

  const an1 = hAnalyze({ id: TEMP_ID });
  emit('chan_analyze_ret', an1);
  emit('chan_analyze_rec', store.get(TEMP_ID));

  const an2 = hAnalyze({ id: TEMP_ID, diag: '咳嗽病', synd: '痰热壅肺证' });
  emit('chan_analyze_override_ret', an2);
  emit('chan_analyze_override_rec', store.get(TEMP_ID));

  const add1 = hAddRx({ id: TEMP_ID, rxText: '茯苓 12克\n白术 9克' });
  emit('chan_addRx_ret', add1);
  emit('chan_addRx_rec', store.get(TEMP_ID));

  emit('chan_addRx_empty_ret', hAddRx({ id: TEMP_ID, rxText: '   ' }));

  const set1 = hSetRx({ id: TEMP_ID, text: '中医诊断：风寒感冒\n处方：\n荆芥 9克\n防风 9克\n羌活 6克\n' });
  emit('chan_setRx_ret', set1);
  emit('chan_setRx_rec', store.get(TEMP_ID));

  emit('chan_setRx_empty_ret', hSetRx({ id: TEMP_ID, text: '  ' }));

  // 混排折行：「临床诊断及证型」被 HIS 折行后证型落在续行 —— 续行拼接 + 两字证素（湿热）归型；
  // 键序两侧统一 sort 后输出（Dictionary/对象遍历序不可靠）
  const wrapKp = Analyze.extractKeyPoints('临床诊断及证型 ： 乳腺肿瘤,多汗症,乳岩,汗病,\n痨瘀阳络证,湿热\nR\n制吴茱萸 3g');
  emit('chan_mixed_wrap', Object.keys(wrapKp).sort().reduce((o, k) => (o[k] = wrapKp[k], o), {}));

  // 诊断内噪声：HIS 防复制在字间混入点号/间隔号/空格（乳.腺肿瘤、乳.岩）→ 粘连回词后再拆条
  const noiseKp = Analyze.extractKeyPoints('临床诊断及证型：乳.腺肿瘤, 多 汗 症, 乳.岩, 汗病,痰瘀阳络证, 湿 热\nR\n制吴茱萸 3g');
  emit('chan_diag_noise', Object.keys(noiseKp).sort().reduce((o, k) => (o[k] = noiseKp[k], o), {}));
  const noise2Kp = Analyze.extractKeyPoints('中医诊断：乳.岩 痰瘀阻络证\n西医诊断：1.乳腺肿瘤 2.多汗症');
  emit('chan_diag_noise2', Object.keys(noise2Kp).sort().reduce((o, k) => (o[k] = noise2Kp[k], o), {}));

  // 诊断清理规则（2026-10-19 截图反馈）：①HIS 卡片布局标签/值分行 → 纯标签行+下一纯值行兜底；
  // ②「舌下含服」不误抓为舌象（负向断言 + 频次词/孤字丢弃）；③处方笺西医诊断不吞并 Rp/药品行
  //（终止符扩 Rp/用法/注意…，剂量条目剔除）
  const cardKp = Analyze.extractKeyPoints('西医诊断\n冠心病 不稳定型心绞痛；心功能Ⅱ级\n中医诊断\n胸痹\n证型\n气虚血瘀证\n主诉\n反复胸闷痛 2 年，加重 3 天。\n治法\n益气活血，通脉止痛。');
  emit('chan_diag_card', Object.keys(cardKp).sort().reduce((o, k) => (o[k] = cardKp[k], o), {}));
  const tongueKp = Analyze.extractKeyPoints('临时\t硝酸甘油片 0.5mg 舌下含服（胸痛发作时）\t舌下\tprn');
  emit('chan_tongue_noise', Object.keys(tongueKp).sort().reduce((o, k) => (o[k] = tongueKp[k], o), {}));
  const rxWestKp = Analyze.extractKeyPoints('中医诊断：筋伤\n证型：气滞血瘀证\n西医诊断：右踝关节陈旧性扭伤\nRp:\n伸筋草 15g 红花 9g 独活 12g\n用法：3剂 水煎外洗');
  emit('chan_rx_west', Object.keys(rxWestKp).sort().reduce((o, k) => (o[k] = rxWestKp[k], o), {}));

  // 诊断要素按后台诊断库比对归一（2026-10-19）：GB/T 病名/证候 + ICD-10 国临版正名——
  // 可选用词→正名、证型简写补证尾、别名收敛、歧义（高血压病3级）原样保留、分隔符统一为「、」
  const DiagNorm = require('../lib/diagnorm');
  const dnKeys = { '中医诊断': '外感咳嗽病、咳嗽病', '证型': '气虚血瘀、气虚血滞证', '西医诊断': '不稳定型心绞痛，冠状动脉粥样硬化性心脏病；高血压病3级' };
  let dnFixes = [];
  try { dnFixes = DiagNorm.normalizeKeys(dnKeys); } catch (e) { dnFixes = []; }
  emit('chan_diag_norm', { keys: dnKeys, fixes: dnFixes });

  // 列式排版剂量重配对（2026-10-19）：AI 视觉按「列」读 HIS 处方表 → 药名列成串（无剂量）、
  // 用法列「水煎内服」被误读成伪药名（冰片）并与剂量列交错 → 载体剂量按序回填真药味并剔除载体行
  const colText = ['柴胡', '白芍', '当归', '白术', '茯苓', '薄荷', '香附', '陈皮', '延胡索', '炙甘草'].join('\n')
    + '\n水煎内服\n冰片 10g 冰片 12g 冰片 10g 冰片 12g 冰片 12g\n冰片 6g 冰片 9g 冰片 6g 冰片 9g 冰片 6g\n日一剂\n7';
  const colItems = TCM.extractRxItems(colText).map(it => ({ c: it.canon, d: it.dose ? (it.dose.val + it.dose.unit) : '' }));
  emit('chan_rx_column', colItems);

  // 诊断括号/噪声段（2026-10-19 晚，镜像 chan_diag_bracket）：OCR 丢右括号（「胸痹（气滞血瘀证」）
  // → 未闭合括号连内容截断；HIS 版块标签（中药汤剂）混进西医诊断 → 噪声段丢弃
  const dbKeys = { '中医诊断': '胸痹（气滞血瘀证', '证型': '气滞血瘀证', '西医诊断': '不稳定型心绞痛、心功能Ⅱ级、中药汤剂' };
  let dbFixes = [];
  try { dbFixes = DiagNorm.normalizeKeys(dbKeys); } catch (e) { dbFixes = []; }
  emit('chan_diag_bracket', { keys: dbKeys, fixes: dbFixes });

  // 用法括号修复（2026-10-19 晚，镜像 chan_usage_bracket）：OCR 丢右括号（含服(胸痛发作时）
  // → 统一全角并补在第一个分隔逗号前
  const ubText = '水煎400ml\n舌下含服(胸痛发作时\n每日1剂\nqd';
  emit('chan_usage_bracket', Analyze.pickUsage(ubText).usage);

  // 列式重配对泛化（2026-10-19 晚，镜像 chan_rx_column2）：载体不只一个——用法列「水煎内服 10g」
  // 「日一剂 12g/9g」自带真剂量且与载体行（冰片）交错，须按文档序合并回填（住院长期医嘱单实录）
  const col2Text = ['柴胡', '冰片 10g', '水煎内服', '日一剂 12g', '日一剂', '白芍', '饮片', '水煎内服 10g', '当归', '饮片',
    '水煎内服', '日一剂', '白术', '冰片 12g', '水煎内服', '日一剂', '茯苓', '冰片 12g', '水煎内服', '日一剂',
    '薄荷', '冰片 6g', '水煎内服', '日一剂 9g', '香附', '饮片', '水煎内服', '日一剂', '陈皮', '冰片 6g',
    '水煎内服', '日一剂', '延胡索', '冰片 9g', '水煎内服', '日一剂', '炙甘草', '冰片 6g', '水煎内服', '日一剂'].join('\n');
  const col2Items = TCM.extractRxItems(col2Text).map(it => ({ c: it.canon, d: it.dose ? (it.dose.val + it.dose.unit) : '' }));
  emit('chan_rx_column2', col2Items);

  // 列式重配对变体三（2026-10-19 晚，镜像 chan_rx_column3）：表头「单剂用量」与首味剂量粘连
  //（单剂用量 10g）、茯苓剂量粘在「水煎内服 12g」——表头词也属伪药名词表，其剂量按文档序入池，
  // 否则整体错位一格（柴胡吃白芍的 12g）。「序号」数字行不产伪药味。
  const col3Text = ['序号', '单剂用量 10g', '柴胡', '饮片', '水煎内服', '日一剂', '白芍', '冰片 12g', '水煎内服', '日一剂',
    '当归', '冰片 10g', '水煎内服', '日一剂', '白术', '冰片 12g', '日一剂', '水煎内服 12g', '日一剂', '茯苓', '饮片',
    '水煎内服', '薄荷', '冰片 6g', '水煎内服', '日一剂', '香附', '冰片 9g', '水煎内服', '日一剂', '陈皮', '冰片 6g',
    '水煎内服', '日一剂', '日一剂', '延胡索', '冰片 9g', '水煎内服', '炙甘草', '冰片 6g', '水煎内服', '日一剂'].join('\n');
  const col3Items = TCM.extractRxItems(col3Text).map(it => ({ c: it.canon, d: it.dose ? (it.dose.val + it.dose.unit) : '' }));
  emit('chan_rx_column3', col3Items);

  // 剂量离谱兜底（2026-10-19 晚，镜像 chan_dose_outlier）：香附 9g 被 OCR 读成 99g —— 不在内置
  // 限量表也会提示「明显超出药典常用量」；黄芪 45g（药典 9-30g）属临床常用重剂，不误报
  const doseOut = [];
  for (const txt of ['香附 99g\n白芍 12g\n柴胡 10g', '黄芪 45g\n当归 12g\n茯苓 15g']) {
    const t = TCM.runTcm({ text: txt, usage: '水煎服，每日1剂' });
    for (const it of ((t.rx && t.rx.items) || [])) {
      if (it && it.cat === '用量核查') doseOut.push({ lv: it.level, tag: it.tag, title: it.title });
    }
  }
  emit('chan_dose_outlier', doseOut);

  // 规格列守卫（2026-10-19 晚，镜像 chan_rx_spec）：HIS「中药处方」表格的规格列「饮片」与
  // 剂量列同行粘连（饮片 10g），形近纠错层曾把它误改成真实药名 冰片（1 字差、同尾「片」、
  // 唯一命中）——OCR 本来读对了，是纠错改坏的。验证：① fixOcrText 后原文不得出现 冰片；
  // ② extractRxItems 剂量按文档序重配对（载体=饮片，其行剂量入池、文本扫描跳过载体词防重复）
  const specText = ['中药处方', '序号', '单剂用量', '柴胡', '饮片 10g', '日一剂', '水煎内服 12g', '白芍', '饮片', '水煎内服', '日一剂',
    '当归', '饮片 10g', '水煎内服', '日一剂', '白术', '饮片 12g', '水煎内服', '日一剂', '茯苓', '饮片 12g', '日一剂', '水煎内服',
    '饮片 6g', '日一剂', '薄荷', '水煎内服', '香附', '饮片 9g', '水煎内服', '日一剂', '陈皮', '饮片 6g', '水煎内服', '日一剂',
    '延胡索', '饮片 9g', '水煎内服', '日一剂', '饮片 6g', '日一剂', '炙甘草', '水煎内服',
    '用法:', '7剂，水煎服，日一剂，分两次温服', '冷水浸泡 30分钟，头煎30分钟'].join('\n');
  const specFixed = KB.fixOcrText(specText, null).text || specText;
  const specIceN = specFixed.split('\n').filter(l => l.trim().indexOf('冰片') === 0).length;
  const specItems = TCM.extractRxItems(specFixed).map(it => ({ c: it.canon, d: it.dose ? (it.dose.val + it.dose.unit) : '' }));
  emit('chan_rx_spec', { iceN: specIceN, items: specItems });

  // 剂数：单位放宽（剂/付/帖）+ 手填优先（applyJi 重算天数/总克，jiManual 标记）
  const RxMetric = require('../lib/rxmetric');
  const jiPick = ['共12味7剂', '共7付', '7帖', '每日2剂，共14剂', '每次1剂，日3次',
    '共7剂, 1日1剂, 每剂含22味药, 自煎, 分早晚两次', '共7剂, 1日2剂, 每剂含22味药'].map(t => RxMetric.pickJi(t));
  const jiDaily = ['每日1剂 水煎服', '1日1剂，自煎，分早晚两次', '1日2剂，分早晚', '共7剂, 1日1剂'].map(t => RxMetric.pickDailyJi(t));
  const jiBase = { herbN: 12, doseG: 120, dailyJi: 2, dailyG: 240, ji: 0, days: 0, totalG: 0, avgG: 10, maxG: 30, maxN: '黄芪', noDoseN: 0 };
  const jiCases = [
    { pick: jiPick, daily: jiDaily },
    { manual: RxMetric.applyJi(jiBase, 7, '党参12g'), auto: RxMetric.applyJi(jiBase, 0, '共7付') },
    { clear: RxMetric.applyJi(RxMetric.applyJi(jiBase, 9, '共7帖'), 0, '共7帖') },
  ];
  emit('chan_rxmetric_ji', jiCases);

  // 跨行纯剂量行关联（tcm.extractRxItems ↔ ExtractRxItems）：HIS 多列排版被 OCR 逐行读出时
  // 药名行与剂量行分离，doseInLine 只认同行会误报缺剂量（真实 2026-10-19 17:43 采集文本）
  const rxqc = require('../lib/rxqc');
  const CD_LINES = ['临床诊断及证型：乳腺肿瘤，多汗症，乳岩，汗病，痰瘀阳络证，湿热', '北柴胡 12g', '制吴茱萸 3g', '12g', '半枝莲',
    '太子参 15g', '姜厚朴 12g', '当归 12g', '桔梗 12g', '法半夏 12g', '浙贝母 12g', '甘草 12g', '生麦芽 12g', '炒六神曲 10g', '12g',
    '白英', '白芍 12g', '白花蛇舌草 12g', '皂角刺 12g', '茯苓块 12g', '虎杖 12g', '陈皮 10g', '麸炒枳实 12g', '黄芪 30g', '12g', '黄连',
    '共7剂，1日1剂，每剂含22味药，自煎，分早晚两次'];
  const cdT = CD_LINES.join('\n');
  const cdTcm = TCM.runTcm({ text: cdT, keys: {} });
  const cdDose = {};
  for (const k of ['半枝莲', '白英', '黄连', '北柴胡']) {
    const d = cdTcm.herbDoses[k];
    cdDose[k] = d ? [d.val, d.unit] : null;
  }
  emit('chan_tcm_crossdose', {
    dose: cdDose,
    subs: cdTcm.subs,
    qc: (() => { const q = rxqc.check({ text: cdT, tcm: cdTcm, usage: '共7剂，1日1剂，水煎，分早晚两次' });
      return { items: q.items.map(x => x.name + ':' + x.issues.map(i => i.code).join(',')), subs: q.subs, summary: q.summary, block: q.block }; })(),
  });

  // 库比对提示（subs）：别名/纠错替换留痕（识别名≠库规范名）——独立短文本锁定
  const subTcm = TCM.runTcm({ text: '茯苓块 12g\n麸炒枳实 12g\n炙苜草 9g', keys: {} });
  emit('chan_qc_subs', { subs: subTcm.subs, doses: subTcm.herbDoses });

  // 重复截取识别（lib/capturefp.js ↔ CaptureFp.cs）：指纹稳定（空白不敏感）+ 覆盖合并保留医生维护字段
  const CF = require('../lib/capturefp');
  const cfDup = { id: 'r1', fp: 'x', keys: { 中医诊断: '乳岩病', 西医诊断: '肿瘤' }, diag: '乳岩', synd: '气血两虚证',
    patient: '张某', pinned: true, rxJi: 9, usage: '每日2剂 医生手填', usageEdited: true,
    review: { status: 'reject', note: '留痕' } };
  const cfRec = { source: 'region', text: '共7剂, 1日1剂', keys: { 中医诊断: '乳岩' }, usage: '每日1剂', tcm: { ok: true } };
  const cfPatch = CF.dedupPatch(cfDup, cfRec);
  if (cfPatch) delete cfPatch.ts;   // 时间戳两侧运行时刻不同，不参与对拍
  emit('chan_capturefp', {
    fp: ['共7剂, 1日1剂', ' 共7剂 \n 1日1剂 ', '共7剂,1日1剂', ''].map(t => CF.textFp(t)),
    patch: cfPatch,
    none: CF.dedupPatch(null, cfRec),
  });

  emit('chan_analyze_missing', hAnalyze({ id: 'no-such-id' }));
  emit('chan_addRx_missing', hAddRx({ id: 'no-such-id', rxText: '茯苓 9克' }));
  emit('chan_setRx_missing', hSetRx({ id: 'no-such-id', text: '茯苓 9克' }));

  // 含未知药（美黄）的处方编辑：tcm.rx.stat.miss 应含美黄（未匹配入队是处理器副作用，不进对拍输出）
  const setUk = hSetRx({ id: TEMP_ID, text: '处方：\n美黄 20g\n茯苓 9克\n' });
  emit('chan_setRx_unknown', (setUk.rec && setUk.rec.tcm && setUk.rec.tcm.rx && setUk.rec.tcm.rx.stat) || null);

  // ---- 处方「用法」手填/修改（main.js record:set-usage，逐字照抄；保存后重跑分析） ----
  function hSetUsage({ id, usage } = {}) {
    const rec = id ? store.get(id) : null;
    if (!rec) return { ok: false, error: '记录不存在' };
    const u = String(usage || '').trim();
    const updated = { ...rec, usage: u, usageEdited: true, usageAt: new Date().toISOString() };
    let compliance = rec.compliance, tcm = rec.tcm;
    try { const an = analyzeRecord(updated); compliance = an.compliance; tcm = an.tcm; } catch (err) { /* 保留原分析 */ }
    const patched = store.patch(id, { usage: u, usageEdited: true, usageAt: updated.usageAt, compliance, tcm,
      qc: rxqc.check({ text: updated.text, tcm, usage: u }) }); // 手填用法后重算（缺用法/缺剂数可解除）
    return { ok: true, rec: patched };
  }
  const u1 = hSetUsage({ id: TEMP_ID, usage: '水煎服，每日1剂，分2次温服' });
  emit('chan_setUsage_ret', u1);
  emit('chan_setUsage_rec', store.get(TEMP_ID));
  emit('chan_setUsage_clear_rec', (hSetUsage({ id: TEMP_ID, usage: '  ' }) || {}).rec || null);
  emit('chan_setUsage_missing', hSetUsage({ id: 'no-such-id', usage: '水煎服' }));

  // ---- main.js:1302 handler: panel:patch（白名单：置顶 / 患者标注 / 人工复核裁定，逐字照抄） ----
  function hPatch({ id, patch } = {}) {
    if (!id || typeof patch !== 'object' || !patch) return { ok: false, error: '参数无效' };
    const p = {};
    if (typeof patch.pinned === 'boolean') p.pinned = patch.pinned; // 白名单：只允许置顶位
    if (typeof patch.patient === 'string') p.patient = patch.patient.trim().slice(0, 20); // 患者标注（空串=清除）
    // 人工复核裁定（仅「已核查·有提示」的记录可裁定）：
    //   {status:'pass'} 通过并存档 | {status:'reject', note} 驳回留痕 | null 撤销裁定
    // 裁定时间由主进程落，前端不可伪造；撤销时写 undefined，落库 JSON.stringify 会省略该键。
    if ('review' in patch) {
      const rv = patch.review;
      if (rv === null) p.review = undefined;
      else {
        const st = (rv && typeof rv === 'object') ? String(rv.status || '') : '';
        if (st !== 'pass' && st !== 'reject') return { ok: false, error: '复核结论无效' };
        p.review = { status: st, note: String(rv.note || '').trim().slice(0, 60), at: new Date().toISOString() };
      }
    }
    if (!Object.keys(p).length) return { ok: false, error: '无有效字段' };
    const r = store.patch(id, p);
    if (!r) return { ok: false, error: '记录不存在' };
    // 撤销裁定时 p.review 为 undefined：落库已被 JSON.stringify 省略，
    // 返回值也一并删键 —— 让「撤销后对象里根本没有 review」成为两侧一致的事实
    // （否则 Electron 的结构化克隆会留下一个值为 undefined 的键，.NET 侧没有）。
    if (p.review === undefined && 'review' in r) delete r.review;
    return { ok: true, rec: r };
  }
  // 只投影白名单字段：整条记录里的时间戳只是噪声（C# 侧 PjPatch 同规则）
  const pjPatch = (name, arg) => {
    const r = hPatch(arg);
    emit(name + '_ret_ok', { ok: r.ok, error: r.error });
    if (!r.ok) return r;
    const rec = r.rec || {};
    return {
      pinned: !!rec.pinned, patient: rec.patient || '', review: rec.review || null,
      hasReviewKey: Object.prototype.hasOwnProperty.call(rec, 'review'),
    };
  };

  emit('chan_patch_pin', pjPatch('chan_patch_pin', { id: TEMP_ID, patch: { pinned: true } }));
  emit('chan_patch_patient', pjPatch('chan_patch_patient', { id: TEMP_ID, patch: { patient: '  张三  ' } }));
  emit('chan_patch_review_pass', pjPatch('chan_patch_review_pass', { id: TEMP_ID, patch: { review: { status: 'pass' } } }));
  emit('chan_patch_review_reject', pjPatch('chan_patch_review_reject',
    { id: TEMP_ID, patch: { review: { status: 'reject', note: '  剂量待确认，请医师复核后重开  ' } } }));
  emit('chan_patch_review_clear', pjPatch('chan_patch_review_clear', { id: TEMP_ID, patch: { review: null } }));
  emit('chan_patch_review_bad', hPatch({ id: TEMP_ID, patch: { review: { status: 'maybe' } } }));
  emit('chan_patch_nonwhite', hPatch({ id: TEMP_ID, patch: { foo: 1 } }));
  emit('chan_patch_bad_arg', hPatch({ id: TEMP_ID, patch: null }));
  emit('chan_patch_missing_rec', hPatch({ id: 'no-such-id', patch: { review: { status: 'pass' } } }));
  emit('chan_patch_restore', hPatch({ id: TEMP_ID, patch: { pinned: false, patient: '', review: null } }));

  emit('chan_analyze_final', hAnalyze({ id: TEMP_ID }));

  // 配伍禁忌库清单：内置歌诀规则 + 规则总览 meta（2026-10-15 扩充后两侧必须逐项一致）
  emit('chan_sbf_list', hSbfList());

  emit('chan_consult_data', hConsultData());

  // ==================== 批次 3：参照库（main.js 同名处理器同源实现）====================
  const gbt = require('../lib/gbt');
  const icdmap = require('../lib/icdmap');
  const refsync = require('../lib/refsync');

  // main.js:1744 handler: ref:info
  function hRefInfo() {
    try { return { ok: true, list: DB.refInfo(), gbtSource: gbt.source(), icdSource: icdmap.source() }; }
    catch (e) { return { ok: false, error: (e && e.message) || String(e), list: [] }; }
  }
  // main.js:1748 handler: ref:sync
  function hRefSync() {
    try { return { ok: true, out: refsync.syncAll(() => {}), info: DB.refInfo() }; }
    catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
  }
  // main.js:1733 handler: gbt:match-diag
  function hGbtMatchDiag() {
    if (!clinicalKb) return [];
    const names = clinicalKb.list(KIND_DIAG).map(d => d.name);
    const m = gbt.matchNames(names);
    return names.map(n => (m.has(n) ? { diag: n, ...m.get(n) } : null)).filter(Boolean);
  }

  emit('chan_ref_info', hRefInfo());
  emit('chan_ref_sync', hRefSync());

  emit('chan_gbt_stats', gbt.stats());
  emit('chan_gbt_search_kw', gbt.search('外感', 'all', '', 600));
  emit('chan_gbt_search_l1', gbt.search('', 'disease', 'A01', 600));
  emit('chan_gbt_search_none', gbt.search('不存在的关键词ZZZ', 'syndrome', '', 600));
  emit('chan_gbt_match_diag', hGbtMatchDiag());

  emit('chan_icd_stats', icdmap.stats());
  emit('chan_icd_search_kw', icdmap.search('霍乱', 'all', 300));
  emit('chan_icd_search_diff', icdmap.search('胃炎', 'diff', 300));
  emit('chan_icd_lookup_name', icdmap.lookupByName('霍乱，由于O1群霍乱弧菌，霍乱生物型所致'));
  emit('chan_icd_lookup_partial', icdmap.lookupByName('古典生物型霍乱'));
  emit('chan_icd_lookup_missing', icdmap.lookupByName('完全不存在ZZZ'));
  emit('chan_icd_lookup_empty', icdmap.lookupByName(''));

  // ==================== 批次 4：Excel 模板 / 映射 / 导出排序 ====================
  const { XLSX_TARGETS, xlsxRowsToObjects, buildTemplateWorkbook } = require('../lib/xlsximport');
  const XLSX = require('xlsx');

  // main.js:1510 handler 的纯逻辑部分（对话框换成本地文件路径）
  const targets = {};
  for (const [k, t] of Object.entries(XLSX_TARGETS)) {
    targets[k] = { title: t.title, store: t.store, sheet: t.sheet,
      cols: t.cols.map(c => ({ header: c[0], field: c[1], sample: c[2] })) };
  }
  emit('chan_xlsx_targets', targets);

  const tplAoa = {};
  for (const k of Object.keys(XLSX_TARGETS)) {
    const { wb } = buildTemplateWorkbook(k);
    const ws = wb.Sheets[wb.SheetNames[0]];
    tplAoa[k] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  }
  emit('chan_xlsx_template_aoa', tplAoa);

  // Excel 往返：JS 写 → JS 读；交叉读 C# 写的文件（上一轮产出）
  {
    const fs = require('fs');
    const dir = path.join(__dirname, '..', '.probe');
    fs.mkdirSync(dir, { recursive: true });
    const rt = {};
    for (const k of ['herb', 'yibao']) {
      const { wb } = buildTemplateWorkbook(k);
      const jsFile = path.join(dir, 'xlsx_js_' + k + '.xlsx');
      XLSX.writeFile(wb, jsFile);
      const wb2 = XLSX.read(fs.readFileSync(jsFile), { type: 'buffer' });
      rt[k + '_self'] = XLSX.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]], { header: 1, defval: '', raw: false });
      const csFile = path.join(dir, 'xlsx_cs_' + k + '.xlsx');
      if (fs.existsSync(csFile)) {
        const wb3 = XLSX.read(fs.readFileSync(csFile), { type: 'buffer' });
        rt[k + '_cross'] = XLSX.utils.sheet_to_json(wb3.Sheets[wb3.SheetNames[0]], { header: 1, defval: '', raw: false });
      }
    }
    emit('chan_xlsx_roundtrip', rt);
  }

  // 行→对象映射（与 C# 同一组输入）
  emit('chan_xlsx_rows_to_objects', {
    byHeader: xlsxRowsToObjects([
      ['名称*', '别名(、分隔)', '性味', '未知列'],
      ['人参叶', '参叶、辽参叶', '苦、甘，寒', '忽略我'],
      ['', '', '', ''],
      ['只有别名', '别名甲', '', ''],
      ['  白芍  ', '  ', '苦、酸，微寒', ''],
      ['name', 'aliases'],
    ], XLSX_TARGETS.herb.cols),
    byField: xlsxRowsToObjects([['name', 'aliases'], ['西红花', '番红花']], XLSX_TARGETS.herb.cols),
  });

  // CSV 解析（与 C# ReadCsv 同一组输入）
  {
    const wb = XLSX.read('名称*,别名,备注\r\n人参叶,"参叶、辽参叶",含逗号\r\n白芍,"白勺,白芍","含""引号"""\r\n',
      { type: 'string' });
    emit('chan_csv_parse', XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false }));
  }

  // 医保导出：对拍参与导出的药名集合（行序为中文排序，两侧 ICU 选音不同，不纳入严格对拍）
  {
    const KBm = require('../lib/kb');
    const rules = userKb ? userKb.ybList() : [];
    const names = [...new Set([...rules.map(r => r.name), ...KBm.getAllHerbs().map(h => h.n).filter(Boolean)])];
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'zh'));
    emit('chan_yibao_export_set', [...names].sort());
    process.stderr.write('[probe-note] yibao-zh-order-head=' + sorted.slice(0, 8).join(',') + '\n');
  }
  // ==================== 批次 4：文件通道（无对话框分支）/ 备份收录清单 ====================
  // main.js 的这些处理器需要对话框；这里只对拍「弹窗前」的参数校验分支与取消回执，
  // 真实弹窗由 C# --probe-ui 的写路径用例覆盖。
  emit('chan_fc_xlsx_import_bad', { ok: false, error: '未知导入类型' });
  emit('chan_fc_xlsx_import_cancel', { canceled: true });
  emit('chan_fc_xlsx_template_bad', { ok: false, error: '未知导入类型' });
  emit('chan_fc_xlsx_template_cancel', { canceled: true });
  emit('chan_fc_pick_import_cancel', { canceled: true });
  emit('chan_fc_clinical_pick_cancel', { canceled: true });
  emit('chan_fc_yibao_export_cancel', { canceled: true });
  emit('chan_fc_backup_export_cancel', { canceled: true });
  emit('chan_fc_backup_import_cancel', { canceled: true });
  emit('chan_fc_data_relocate_cancel', { canceled: true });
  {
    const portable = require('fs').existsSync(path.join(__dirname, '..', 'portable.dat'));
    emit('chan_fc_data_info', { dirKind: portable ? 'portable' : 'appdata', portable });
  }

  // 备份收录清单：逐字照抄 lib/backup.js 的 walk/collectFiles（只取相对路径，避免写 40MB 包）
  {
    const fsm = require('fs');
    const USER_ROOT = () => USER_DATA;
    const BACKUP_DIRS = ['records', 'knowledge', 'config'];
    const ROOT_FILES = ['data.db', 'syscfg.json', 'ocr.json'];
    function walk(dir, base, out) {
      let ents = [];
      try { ents = fsm.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
      for (const ent of ents) {
        const full = path.join(dir, ent.name);
        const rel = path.posix.join(base, ent.name);
        if (ent.isDirectory()) { if (ent.name !== '_migrated') walk(full, rel, out); }
        else if (ent.isFile()) {
          if (ent.name.endsWith('.migrated') || ent.name.endsWith('.json') && base === 'records') continue;
          out.push(rel);
        }
      }
      return out;
    }
    const files = [];
    for (const d of BACKUP_DIRS) walk(path.join(USER_ROOT(), d), d, files);
    for (const f of ROOT_FILES) if (fsm.existsSync(path.join(USER_ROOT(), f))) files.push(f);
    emit('chan_backup_manifest', { tag: 'qihuang-capture-backup', count: files.length, rels: [...files].sort() });
  }

  // 备份恢复路径白名单（逐字照抄 lib/backup.js 的 safeRel）
  {
    const BACKUP_DIRS = ['records', 'knowledge', 'config'];
    const ROOT_FILES = ['data.db', 'syscfg.json', 'ocr.json'];
    function safeRel(p) {
      const rel = String(p || '').replace(/\\/g, '/');
      if (rel.includes('..') || path.isAbsolute(rel)) return null;
      const top = rel.split('/')[0];
      if (BACKUP_DIRS.includes(top) || ROOT_FILES.includes(rel)) return rel;
      return null;
    }
    emit('chan_backup_saferel', ['data.db', 'records/a.png', 'records/sub/b.png', 'knowledge/herbs.json', 'config/x.json',
      'backups/auto-1.bak.json', '../evil.txt', 'records/../../evil.txt', '..\\evil.txt',
      '/abs/path', 'C:/abs/path', 'syscfg.json', 'ocr.json', 'data.db-wal', 'other/x.txt', '']
      .map(c => ({ in: c, out: safeRel(c) })));
  }
  // ==================== 批次 5：AI 层（演示模式，绝不发起真实请求）====================
  const rag = require('../lib/rag');
  const ai = require('../lib/ai');
  ai.initAi(USER_DATA); // 对齐 main.js 启动：否则 cfg 仍是 DEFAULTS，与宿主的真实配置对不上

  // ai.js 未导出 ROLE，此处逐字照抄（与 C# Ai.Role 对照）
  const ROLE = [
    '你是「岐黄鉴方」，一名中医执业级审方与病历内涵质控助手，服务于医院中医临床与病案质控场景。',
    '回答要求：',
    '1. 始终基于给到的病历/处方/知识库上下文作答，不编造依据；知识库未收录时明确说“本地库未收录，建议人工核对权威典籍”。',
    '2. 使用简体中文，输出 Markdown，善用 加粗、短段落、要点列表；涉及正文引用时给出出处（如《伤寒论》）。',
    '3. 辨证推理须展示证据链（症状 → 舌脉/体征 → 证型 → 治法 → 方剂），不要直接跳结论。',
    '4. 你提供的仅是基于规则与知识的辅助参考，不等同于执业诊断与处方；结尾保留一句：本内容由 AI 生成，仅供学习参考，需经执业医师核对。',
    '5. 输入文本均已做脱敏，禁止复述或推断其中可能的姓名、证件、电话等个人隐私内容。',
  ].join('\n');
  // `at` 是 Date.now()，取值必然不同：两侧都归一成「类型:位数」，既遮罩取值又保留字段存在性
  const normAi = (o) => {
    if (!o || typeof o !== 'object') return o;
    const c = Object.assign({}, o);
    if (c.at !== undefined) c.at = typeof c.at + ':' + String(c.at).length;
    return c;
  };

  // RAG 检索（纯函数）
  emit('chan_rag_search', ['白术', '四君子汤', '咳嗽痰多怎么调理', '甘草有什么功效', '完全不存在的词ZZZ', '请问 大黄 的作用']
    .map(q => {
      const hits = rag.search(q, 8);
      return { q, clean: rag.cleanQuery(q), hits, ctx: rag.toContext(hits) };
    }));

  // Prompt 组装（逐字照抄 lib/ai.js 的 buildQcPrompt/buildDialecticPrompt/buildRxPrompt/buildAskPrompt）
  function trunc(s, n) { const t = String(s || '').trim().replace(/\s+/g, ' '); return t.length > n ? t.slice(0, n) + '…' : t; }
  function herbLine(h) { return `- ${h.n}：${h.fx || ''}${h.prop ? '（' + h.prop + '）' : ''}${h.use ? ' 用法' + h.use : ''}`; }
  function buildQcPrompt(text, compliance) {
    const parts = ['请对以下【已脱敏病历片段】做内涵质控解读。要求：',
      '## 一、总体评价：一两句话概括文书质量与最大风险点；',
      '## 二、逐条解读：对每条机器质检提示，用医生能懂的话解释“为什么扣分、缺什么”，并给出可直接改写的补全示例；',
      '## 三、改进优先级：按 必须修改 > 建议完善 > 提示 排序给出前三项。',
      '', '【病历片段】', text || '（空）'];
    if (compliance && compliance.hasRecord) {
      parts.push('', '【规则引擎质控结果（得分 ' + (compliance.score ?? '-') + ' · ' + (compliance.grade || '') + '）】');
      (compliance.items || []).slice(0, 12).forEach(it => {
        parts.push(`- [${it.level}] ${it.title}${it.detail ? '：' + it.detail : ''}${it.advice ? ' 建议：' + it.advice : ''}`);
      });
    } else {
      parts.push('', '（规则引擎未判定为完整病历文书，请据实判断是否具备质控要素：主诉、现病史、既往史、诊断依据、治疗计划等）');
    }
    return parts.join('\n');
  }
  function buildDialecticPrompt(text, keys) {
    const parts = ['请对以下【四诊/病史片段】做中医辨证推理。要求输出：',
      '## 一、证据提取：列出关键症状与舌脉信息（用列表，标注阴阳/寒热/虚实倾向）；',
      '## 二、辨证推理链：逐条写出 症状 → 病机 → 证型 的推理步骤；',
      '## 三、证型与治法：给出最可能证型 1-2 个及相应治法；',
      '## 四、方剂建议：给出 1-2 首代表方（含出处）并简述组方思路，若与本地知识库检索结果一致可注明“与库内方书一致”。',
      '', '【四诊/病史】', trunc(text, 1500)];
    if (keys && Object.keys(keys).length) {
      parts.push('', '【已抽取要点】' + Object.keys(keys).map(k => k + '：' + keys[k]).join('；'));
    }
    return parts.join('\n');
  }
  function buildRxPrompt(herbs, rx) {
    const parts = ['请对以下【中药处方】做点评并生成患者教育。要求输出：',
      '## 一、方义解读：按 君臣佐使 拆解各药角色（一行一药）；',
      '## 二、安全性核查：复核剂量是否在常规范围、有无 十八反/十九畏、妊娠禁忌、毒性药风险；',
      '## 三、患者用药教育：用通俗语言说明煎服法、忌口、可能反应与就医指征，供患者阅读。',
      '', '【处方药味】'];
    herbs.forEach(h => { parts.push(herbLine(h)); });
    if (!herbs.length) parts.push('（未能从文本解析出具体药味，请据下方文本尽力提取或说明缺项）');
    if (rx && rx.items && rx.items.length) {
      parts.push('', '【规则引擎合规结果】');
      rx.items.slice(0, 8).forEach(it => parts.push(`- [${it.level}] ${it.title}${it.detail ? '：' + it.detail : ''}`));
    }
    return parts.join('\n');
  }
  function buildAskPrompt(question, ctxText) {
    return ['请基于下方【本地知识库检索片段】回答用户问题。',
      '要求：优先采用检索到的条目作答并注明其类型（中药/方剂）与出处；检索片段不足以回答时，如实说明并给出最接近的扩展阅读方向；不要编造未收录的药效与剂量。',
      '', '【本地知识库检索片段】', ctxText || '（无命中）', '',
      '【用户问题】', String(question || '').trim()].join('\n');
  }
  // mock 降级内容（逐字照抄 lib/ai.js 的 mockReply）
  function mockReply(text) {
    const t = String(text || '');
    const hasJb = /质控|内涵/.test(t);
    const hasBz = /辨证|四诊/.test(t);
    const hasCf = /处方|药味|点评/.test(t) || /^- .*(克|g|G)/m.test(t);
    const secs = [];
    if (hasJb) secs.push('## 一、总体评价\n主诉与诊断信息基本齐备，核心风险在**主诉过于简短、缺发病诱因与伴随症状**。\n\n## 二、逐条解读\n- **【建议完善】主诉不完整**：现描述未含起病诱因、部位性质与持续时间，质控要求“症状+时间”。示例改写：`反复上腹隐痛3月，进食后加重，伴反酸嗳气。`\n\n## 三、改进优先级\n1. 补齐主诉时间轴与诱因\n2. 完善现病史伴随症状\n3. 明确诊断分型依据');
    if (hasBz) secs.push('## 一、证据提取\n- 乏力、气短、面色少华 → 气虚\n- 纳差、便溏、舌淡苔白 → 脾虚湿停\n\n## 二、辨证推理链\n乏力倦怠 → 脾气亏虚，运化失健 → 湿浊内生、气血生化不足。\n\n## 三、证型与治法\n脾虚气滞证 → **健脾益气、行气化湿**\n\n## 四、方剂建议\n- **四君子汤**（《太平惠民和剂局方》）益气健脾，为治本之方\n- 兼腹胀者合陈皮、半夏（六君子汤意）');
    if (hasCf) secs.push('## 一、方义解读\n- 君：以补气健脾药为主，针对气虚之本\n- 臣：理气化湿药助运，防补而壅滞\n- 佐使：调和诸药、引经\n\n## 二、安全性核查\n未检出十八反/十九畏配伍禁忌；各味剂量均在常规范围；无妊娠禁忌提示。\n\n## 三、患者用药教育\n水煎服，早晚饭后温服；忌生冷油腻；如服后腹胀或便溏加重请复诊调整。');
    if (!secs.length) {
      return '## 回答\n根据本地知识库检索结果，该问题建议先核对以下方向：\n- 若为药性/功效咨询：检索到的中药条目通常含性味归经、功效与注意事项；\n- 若为方剂咨询：检索到的方剂条目含出处、组成、主治与加减法；\n- 检索未命中时，本地库未收录，建议人工核对《中国药典》与《方剂学》权威来源。\n\n本内容由 AI 生成，仅供学习参考，需经执业医师核对。';
    }
    return secs.join('\n\n') + '\n\n> 本内容由 AI 生成，仅供学习参考，需经执业医师核对。';
  }
  function maxTokensCap(model) { const m = String(model || '').toLowerCase(); if (/^glm-4v/.test(m)) return 1024; return 4096; }
  function joinContinue(main, piece) {
    let p = piece.trim();
    const tails = String(main).split('\n').map(s => s.trim()).filter(Boolean);
    const last = tails[tails.length - 1] || '';
    if (last && p.startsWith(last)) p = p.slice(last.length).replace(/^\s*[:：]?\s*/, '');
    const seam = /[-—:：、)\）》]\s*$/.test(String(main)) ? '' : '\n';
    return main + seam + p;
  }
  {
    // 视觉探测图生成（lib/ai.js visionProbePng 未被导出，此处逐字照抄）
    const VP = (() => {
      const zlib = require('zlib');
      function crc32(buf) { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } let cr = 0xFFFFFFFF; for (const b of buf) cr = t[(cr ^ b) & 0xFF] ^ (cr >>> 8); return (cr ^ 0xFFFFFFFF) >>> 0; }
      function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
      const W = 64, H = 64, ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; // 8bit RGB
      const raw = Buffer.alloc(H * (1 + W * 3));
      for (let y = 0; y < H; y++) { raw[y * (1 + W * 3)] = 0; for (let x = 0; x < W; x++) { const o = y * (1 + W * 3) + 1 + x * 3; raw[o] = 200; raw[o + 1] = 60; raw[o + 2] = 50; } }
      return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
    })();
    // PNG 结构摘要（与 C# ChanProbe.PngDigest 同口径）：尺寸字段 + 解压后扫描线的 sha256 前 16 位
    const pngDigest = (png) => {
      let off = 8; const raws = []; const ihdr = { w: 0, h: 0, bit: 0, color: 0 };
      while (off + 8 <= png.length) {
        const len = png.readUInt32BE(off);
        const type = png.toString('latin1', off + 4, off + 8);
        const dataOff = off + 8;
        if (type === 'IHDR') { ihdr.w = png.readUInt32BE(dataOff); ihdr.h = png.readUInt32BE(dataOff + 4); ihdr.bit = png[dataOff + 8]; ihdr.color = png[dataOff + 9]; }
        else if (type === 'IDAT') raws.push(require('zlib').inflateSync(png.subarray(dataOff, dataOff + len)));
        off = dataOff + len + 4;
      }
      const raw = Buffer.concat(raws);
      return Object.assign({}, ihdr, {
        raw_len: raw.length,
        raw_sha: require('crypto').createHash('sha256').update(raw).digest('hex').slice(0, 16),
      });
    };
    const compliance = { hasRecord: true, score: 78, grade: '乙', items: [
      { level: '必须修改', title: '主诉不完整', detail: '无起病诱因与时间', advice: '补「反复上腹隐痛3月」' },
      { level: '提示', title: '舌脉缺失' },
    ] };
    const complianceEmpty = { hasRecord: false, items: [] };
    const keys = { 中医诊断: '咳嗽病', 证型: '痰热壅肺证', 主诉: '咳嗽咳痰3天' };
    const herbs = [{ n: '麻黄', fx: '发汗解表', prop: '辛温', use: '6-9g' }, { n: '苦杏仁', fx: '止咳平喘', prop: '', use: '' }];
    const rx = { items: [{ level: 'risk', title: '十八反配伍', detail: '附子 反 半夏' }, { level: 'info', title: '常用量上限' }] };
    emit('chan_ai_prompts', {
      qc: buildQcPrompt('主诉：咳嗽咳痰3天。', compliance),
      qc_empty: buildQcPrompt('', complianceEmpty),
      dialectic: buildDialecticPrompt('咳嗽  咳痰3天\n\n舌红苔黄', keys),
      dialectic_nokeys: buildDialecticPrompt('乏力纳差', {}),
      rx: buildRxPrompt(herbs, rx),
      rx_empty: buildRxPrompt([], null),
      ask: buildAskPrompt('白术有什么功效？', '[1] 中药「白术」白术 别名 于术 性味 苦甘温'),
      ask_nohits: buildAskPrompt('  未知问题  ', ''),
      herbline: herbLine(herbs[0]),
      role: ROLE,
      mock_qc: mockReply('请做内涵质控解读'),
      mock_bz: mockReply('请做辨证推理'),
      mock_cf: mockReply('- 麻黄 9克'),
      mock_other: mockReply('随便问问'),
      maxcap: { glm4v: maxTokensCap('glm-4v-flash'), chat: maxTokensCap('deepseek-chat') },
      join1: joinContinue('第一段\n## 二、辨证', '## 二、辨证推理\n继续写'),
      join2: joinContinue('末句：', '续写内容'),
      join3: joinContinue('末句', '续写内容'),
      // PNG 结构摘要：解压后的扫描线内容（压缩流两侧 zlib 版本不同，不可逐字节比）
      vision_png: pngDigest(VP),
    });
  }

  // 配置：先记下原始库值，跑完原样还原（探针不留痕）
  // 环境无关：真实库可能存有用户自己的模型配置（deepseek/glm 等），先覆写为已知测试配置再取证，
  // 否则 chan_ai_config_get/roundtrip 随用户配置漂移、对拍必假差异
  const AI_PATCH_CFG = {
    temperature: 0.75, mock: true,
    stripRules: '# 注释行\n忽略我\n~整行剔除\n/\\d+/g\n\n' + 'x'.repeat(4100),
    models: [
      { id: 'zz1', label: '  ', baseURL: ' https://x.example/v1/chat/completions ', model: ' m ', role: '不合法角色', apiKey: 'plain-key-12345678' },
      { id: 'zz2', label: '视觉', baseURL: 'https://y/v1', model: 'vl', role: 'vision', apiKey: '' },
    ],
    chatId: '不存在的id',
  };
  savedAi = DB.kvGet('ai');
  ai.updateCfg(AI_PATCH_CFG);
  emit('chan_ai_config_get', ai.publicCfg());
  const cfgVal = ai.publicCfg();
  emit('chan_ai_cfg_roundtrip', ai.updateCfg(cfgVal));
  emit('chan_ai_cfg_patch', ai.updateCfg(AI_PATCH_CFG));
  // 只还原 stripRules 内存态：其余（mock/temperature/models）保持污染态，
  // 否则后续 ai:run 会去打真实接口，两侧网络行为不同必然假差异。
  // ⚠ 顺序不能反：ai.updateCfg 内部会 saveCfg() 落库，必须先改内存、最后再还原 kv，
  // 否则"还原"会被紧随其后的一次落库覆盖掉（曾致用户真实 API Key 被测试值顶掉）。
  try { ai.updateCfg({ stripRules: String(((savedAi || {}).stripRules) || '') }); } catch (e) {}
  // ⚠ kv 的真正还原放在最末（见文件末尾 finally）：后续 ai:* 用例会 saveCfg() 再次落库。

  // 剔除规则
  emit('chan_ai_strip_rules', (() => {
    const out = [];
    const drop = [{ sub: '整行剔除' }];
    const cut = [{ sub: '忽略我' }, { re: /\d+/g }];
    for (const l of [{ text: '本方含 12g 甘草', conf: 0.9 }, { text: '忽略我的一行', conf: 0.9 },
      { text: '整行剔除这行', conf: 0.9 }, { text: '正常一行 9克', conf: 0.9 }, { text: '123456', conf: 0.9 }]) {
      let t = String((l && l.text) || '');
      if (!t) continue;
      if (drop.some(d => (d.re ? d.re.test(t) : t.includes(d.sub)))) continue;
      for (const c of cut) t = c.re ? t.replace(c.re, '') : t.split(c.sub).join('');
      t = t.trim();
      if (t) out.push(Object.assign({}, l, { text: t }));
    }
    return out;
  })());

  // 后台「AI 设置 → 自动清理噪音」：从识别文本自动推荐清理规则（纯本地启发式，两侧同源实现）
  emit('chan_admin_strip_suggest', (() => {
    const S = require('../lib/stripsuggest');
    const text = [
      '处方笺', '✓ 中医诊断：咳嗽', '1. 酒大黄 3g', '2. 黄芪 15g', '1克*1g/g',
      '(共14味7剂 每日1剂院内煎常规煎 分早晚两次饭后内服)', '共14味7剂', '—————',
      '打印时间：2026-10-17 10:22', '第 1 页', '其它', '其它',
    ].join('\n');
    // existing 刻意含「处方笺 / ✓ / 分隔线」三条，验证已存在的不再推荐
    const r = S.suggest(text, { drop: ['处方笺'], cut: ['✓'], adv: '/^[-—_=]{3,}$/' });
    return { candidates: r.candidates, stats: r.stats };
  })());

  // 遮罩工具条「药」：识别文本 → 各药品说明 / 用法 / 预判方剂（纯逻辑，不跑 OCR，两侧同源）
  emit('chan_herb_cards', (() => {
    const H = require('../lib/herbcards');
    const r = H.build([
      '酒大黄 3g', '黄芪 15g', '党参 12g', '白术 10g', '茯苓 15g',
      '陈皮 6g', '半夏 9g', '甘草 6g', '每日1剂 水煎服 分早晚两次饭后内服',
    ].join('\n'));
    return {
      ok: r.ok, type: r.type, typeLabel: r.typeLabel, msg: r.msg, usage: r.usage, herbs: r.herbs,
      cards: (r.cards || []).map(c => ({ n: c.n, cat: c.cat, prop: c.prop, fx: c.fx, use: c.use, note: c.note, dose: c.dose, tox: c.tox, pre: c.pre })),
      preds: (r.preds || []).map(p => ({ n: p.n, origin: p.origin, m: p.m, s: p.s, comp: p.comp, hit: p.hit, miss: p.miss, inter: p.inter, compSize: p.compSize, covF: p.covF, covRx: p.covRx, classic: p.classic })),
    };
  })());
  emit('chan_herb_cards_empty', require('../lib/herbcards').build('   '));

  // 处方点评（后台「处方点评」页签的纯判定逻辑，两侧同源：lib/rxreview.js ↔ Domain/RxReview.cs）
  const RX_ITEM = i => ({ cls: i.cls, clsLabel: i.clsLabel, level: i.level, tag: i.tag, title: i.title, detail: i.detail, advice: i.advice });
  const RX_ONE = (ctx) => {
    const r = require('../lib/rxreview').reviewOne(ctx);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, verdict: r.verdict, verdictLabel: r.verdictLabel, score: r.score, summary: r.summary,
      cats: r.cats, levels: r.levels, stat: r.stat, herbs: r.herbs, items: r.items.map(RX_ITEM) };
  };
  // 问题处方：十八反（甘草×甘遂、附子×半夏）、附子无先煎、27 味大处方、14 剂、无诊断无证型无用法
  const RX_BAD = [
    '黄芪 15g', '党参 12g', '甘草 10g', '甘遂 3g', '附子 20g', '半夏 9g', '白术 10g', '茯苓 15g',
    '陈皮 6g', '当归 12g', '川芎 10g', '白芍 15g', '熟地黄 15g', '山药 15g', '山茱萸 12g', '泽泻 10g',
    '牡丹皮 10g', '桂枝 6g', '防风 10g', '荆芥 10g', '桔梗 6g', '杏仁 10g', '贝母 10g', '紫菀 10g',
    '款冬花 10g', '桑白皮 12g', '黄芩 10g', '黄连 6g',
  ].join('\n') + '\n共28味14剂';
  // 规范处方：小方 + 诊断 + 证型 + 用法 + 7 剂（应判「合理处方」）
  const RX_OK = [
    '黄芪 15g', '白术 10g', '茯苓 15g', '陈皮 6g', '半夏 9g', '共5味7剂', '每日1剂 水煎服 分早晚两次饭后内服',
  ].join('\n');
  emit('chan_rx_review', RX_ONE({ tcm: require('../lib/tcm').runTcm({ text: RX_BAD }), text: RX_BAD }));
  emit('chan_rx_review_ok', RX_ONE({
    tcm: require('../lib/tcm').runTcm({ text: RX_OK, keys: { 中医诊断: '咳嗽', 证型: '痰湿蕴肺证' } }),
    text: RX_OK, diag: '咳嗽', synd: '痰湿蕴肺证' }));
  emit('chan_rx_review_norx', RX_ONE({ tcm: require('../lib/tcm').runTcm({ text: '每日1剂 水煎服' }), text: '每日1剂 水煎服' }));
  // 红线规则（后台「点评红线」可维护）：单日剂量 / 天数 / 味数 / 辨证相符率 / 全部停用
  const RX_R = (text, keys, diag, synd, rules) => RX_ONE(Object.assign({
    tcm: require('../lib/tcm').runTcm({ text, keys }), text
  }, diag ? { diag } : {}, synd ? { synd } : {}, { rules }));
  const RX_DOSE = '黄芪 90g\n甘草 6g\n每日2剂 水煎服';                 // 90g × 每日2剂 = 180g/日
  const RX_JI = '黄芪 15g\n甘草 6g\n共2味20剂';                        // 20 剂 > 天数红线 14
  const RX_HB = ['黄芪 15g', '白术 10g', '茯苓 15g', '陈皮 6g', '半夏 9g', '当归 12g', '川芎 10g', '白芍 15g', '每日1剂 水煎服'].join('\n');
  const RX_SD = '麻黄 10g\n桂枝 10g\n荆芥 10g\n防风 10g\n生姜 6g';      // 诊断消渴·阴虚燥热 → 相符率 0%
  emit('chan_rx_rule_dose', RX_R(RX_DOSE, null, '', '', { doseWarn: 60, doseErr: 120 }));
  emit('chan_rx_rule_ji', RX_R(RX_JI, null, '', '', { jiWarn: 7, jiErr: 14 }));
  emit('chan_rx_rule_herb', RX_R(RX_HB, null, '', '', { herbWarn: 5, herbErr: 8 }));
  emit('chan_rx_rule_synd', RX_R(RX_SD, { 中医诊断: '消渴', 证型: '阴虚燥热' }, '消渴', '阴虚燥热', { syndRateWarn: 30, syndRateErr: 15 }));
  emit('chan_rx_rule_off', RX_R(RX_BAD, null, '', '', { herbOn: false, doseOn: false, jiOn: false, syndOn: false }));
  // 红线配置归一化（非法值回落默认 / 阈值自洽纠正 / null 视同未配置）——两侧必须同结果
  emit('chan_rxrule_norm', require('../lib/rxreview').normalizeRules({
    herbWarn: 'abc', herbErr: 10, doseWarn: null, jiWarn: 9999, syndRateWarn: 30, syndRateErr: 60, syndMiss: 'error'
  }));
  // 识别质检（缺剂量 / 药名未入库 / 剂量异常 / 缺用法剂数）——面板红框标选与拦截分析的依据
  const RXQC = require('../lib/rxqc');
  const QC_ONE = (text, usage) => {
    const tcm = require('../lib/tcm').runTcm({ text, usage: usage || '' });
    return RXQC.check({ text, tcm, usage: usage || (tcm && tcm.usage) || '' });
  };
  emit('chan_qc_clean', QC_ONE('黄芪 15g\n白术 10g\n茯苓 12g\n甘草 6g', '每日1剂 水煎服 分早晚两次饭后内服'));
  emit('chan_qc_nodose', QC_ONE('黄芪 15g\n党参\n白术 10g\n茯苓 12g', ''));
  emit('chan_qc_unknown', QC_ONE('麒麟蝎 10g\n黄芪 15g\n甘草 6g', '每日1剂 水煎服'));
  emit('chan_qc_doseodd', QC_ONE('石膏 500g\n甘草 6g', '每日1剂 水煎服'));
  emit('chan_qc_nousage', QC_ONE('黄芪 15g\n白术 10g\n茯苓 12g', ''));
  emit('chan_qc_noji', QC_ONE('黄芪 15g\n白术 10g\n茯苓 12g', '水煎服 分两次服'));
  emit('chan_qc_norx', QC_ONE('患者诉腰痛，活动受限，纳眠可，二便调。', ''));
  emit('chan_qc_msg', { msg: RXQC.blockMsg(QC_ONE('黄芪 15g\n党参\n白术 10g', '')) });

  emit('chan_rx_batch', (() => {
    const b = require('../lib/rxreview').reviewBatch([
      { id: 'a', ts: '2026-10-18T01:00:00.000Z', source: 'region', tcm: require('../lib/tcm').runTcm({ text: RX_BAD }), text: RX_BAD },
      { id: 'b', ts: '2026-10-18T01:01:00.000Z', source: 'clipboard', tcm: require('../lib/tcm').runTcm({ text: RX_OK, keys: { 中医诊断: '咳嗽', 证型: '痰湿蕴肺证' } }), text: RX_OK, diag: '咳嗽', synd: '痰湿蕴肺证' },
      { id: 'c', ts: '2026-10-18T01:02:00.000Z', source: 'region', tcm: require('../lib/tcm').runTcm({ text: '每日1剂 水煎服' }), text: '每日1剂 水煎服' },
    ]);
    return { ok: b.ok, total: b.total, reasonableN: b.reasonableN, irrationalN: b.irrationalN, skippedN: b.skippedN,
      rate: b.rate, catN: b.catN, avgScore: b.avgScore, problemTop: b.problemTop, herbTop: b.herbTop, rows: b.rows };
  })());

  // 程序目录镜像备份（换机防丢）：只比可用性 —— 路径/份数随环境而变，不做对拍
  emit('chan_backup_mirror_info', (() => {
    try {
      const r = require('../lib/backup').mirrorInfo();
      return { ok: !!r.ok, enabled: !!r.ok, hasDir: !!(r && r.dir) };
    } catch (e) { return { ok: false, enabled: false, hasDir: false, error: 'ERR' }; }
  })());

  // 通道分支（逐字对齐 main.js:1349 / 1354 / 1359 三个 handler，**含各自的 try/catch**）
  //
  // 教训：探针此前只抄了 handler 的返回逻辑、**没抄 catch**，于是 `ai:run` 在网络不通时
  // 异常直接冒泡，被外层那块「包住全部场景」的 try/catch 接住，
  // 结果是 chan_ai_test 之后的 19 个场景**全部不再执行**（对拍表现为「仅 CS 有」）。
  // 忠实度要求 handler 长什么样就抄成什么样 —— catch 也是它行为的一部分。
  const aiNotInit = () => ({ ok: false, error: 'AI 未初始化' });
  const hAiTest = async () => {
    if (!ai) return aiNotInit();
    try { return await ai.runTest(); } catch (err) { return { ok: false, error: err.message, code: err.code }; }
  };
  const hAiTestModel = async (id) => {
    if (!ai) return aiNotInit();
    try { return await ai.runTestModel(id); } catch (err) { return { ok: false, error: err.message, code: err.code }; }
  };
  const hRunAi = async (kind, payload) => {
    if (!ai) return aiNotInit();
    try {
      if (kind === 'record') {
        const id = payload && payload.id;
        const rec = id ? store.get(id) : null;
        if (!rec) return { ok: false, error: '记录不存在（可能已被删除）' };
        let { compliance, tcm } = rec;
        if (!compliance || !tcm || payload.diag || payload.synd) {
          const r = analyzeRecord(rec, { diag: payload.diag, synd: payload.synd });
          compliance = r.compliance; tcm = r.tcm;
        }
        const keys = Object.assign({}, rec.keys || {});
        if (payload && payload.synd) keys['证型'] = String(payload.synd);
        if (payload && payload.diag) keys['中医诊断'] = String(payload.diag);
        return await ai.runAi('record', { text: rec.text, keys, compliance, tcm });
      }
      return await ai.runAi(kind, payload || {});
    } catch (err) {
      return { ok: false, error: err.message, code: err.code };
    }
  };
  emit('chan_ai_test', await hAiTest());
  emit('chan_ai_test_model_unknown', await hAiTestModel('no-such-id'));
  emit('chan_ai_run_unknown_kind', await hRunAi('no-such-kind', {}));
  emit('chan_ai_run_ask_empty', await hRunAi('ask', { question: '  ' }));
  emit('chan_ai_run_ask', normAi(await hRunAi('ask', { question: '白术有什么功效？' })));
  emit('chan_ai_run_record_missing', await hRunAi('record', { id: 'no-such-id' }));
  emit('chan_ai_run_record', normAi(await hRunAi('record', { id: TEMP_ID })));
  // 清理：把探针/分析路径制造的 pending 从队列移除（kb:unm-ai 场景要求队列状态确定）。
  // 注意必须放在紧前面——chan_analyze_final 等用例会再次触发入队。
  // 名单只收「确由探针夹具/OCR 误识产生」的名字（美黄←黄芪、自英←白英），不碰医生真实数据。
  const PROBE_UNM_NAMES = ['美黄', '自英'];
  for (const it of userKb.unmatchedList())
    if (PROBE_UNM_NAMES.includes(it.name) && it.status === 'pending') userKb.unmatchedRemove(it.id);
  emit('chan_unm_ai', await (async () => {
    const pending = userKb.unmatchedList().filter(x => x.status === 'pending');
    if (!pending.length) return { ok: true, resolved: 0, note: '队列里没有待处理药名' };
    return { ok: false, error: '(unexpected pending)' };
  })());
  emit('chan_unm_ai_unknown_id', await (async () => {
    const pending = userKb.unmatchedList().filter(x => x.status === 'pending' && x.id === 'no-such-unmatched');
    if (!pending.length) return { ok: true, resolved: 0, note: '队列里没有待处理药名' };
    return { ok: false, error: '(unexpected pending)' };
  })());

  // ================= 批次 6：采集链路与外壳通道 =================

  // 通道清单：现场 grep main.js + lib/*.js 的 ipcMain.handle/on，
  // 与 C# 侧 HostBridge 已注册通道集合比对 —— 一个不多、一个不少。
  {
    const fsMod = require('fs');
    const pathMod = require('path');
    const rootDir = pathMod.join(__dirname, '..');
    const files = [pathMod.join(rootDir, 'main.js')].concat(
      fsMod.readdirSync(pathMod.join(rootDir, 'lib')).filter(f => f.endsWith('.js'))
        .map(f => pathMod.join(rootDir, 'lib', f)));
    const set = new Set();
    for (const f of files) {
      const t = fsMod.readFileSync(f, 'utf8');
      const re = /ipcMain\.(?:handle|on)\(\s*'([^']+)'/g;
      let m; while ((m = re.exec(t))) set.add(m[1]);
    }
    // 宿主专用通道：WebView2 的 shim 检测 -webkit-app-region 后转发（Electron 原生
    // 实现该命中测试，无需通道），两侧通道清单比对时计入 C# 侧，故 JS 基线补齐。
    set.add('win:drag'); set.add('win:drag-dbl');
    emit('chan_channels', [...set].sort());
  }

  // 粘贴框实时分段预览（噪声判定与入库管线同源）
  {
    const noise = require('../lib/noise');
    // 与 main.js paste:segment 同逻辑：分剂量行 → 剔除规则 → 折行回拼（预览即所见）
    const StripRules = require('../renderer/strip-rules.js');
    let sr = '';
    try { sr = String(((ai && ai.publicCfg && ai.publicCfg()) || {}).stripRules || ''); } catch (e) {}
    if (!sr) { try { sr = String((DB.kvGet && DB.kvGet('ai') || {}).stripRules || ''); } catch (e) {} }
    let merged = Analyze.mergeDoseLines(String('医嘱名称\n党参 20g\n规格\n---\n白术 12g\n临时医嘱\n21').replace(/[ \t]+/g, ' '));
    try { if (sr.trim()) merged = StripRules.applyText(merged, sr).join('\n'); } catch (e) {}
    try { merged = Analyze.reflowWrappedUsage(merged); } catch (e) {}
    const lines = merged.split('\n').map(s => s.trim()).filter(s => s);
    const rows = lines.map(s => ({ text: s, tag: noise.isNoiseLine(s) }));
    const kept = rows.filter(r => !r.tag).length;
    emit('chan_paste_segment', { rows, kept, removed: rows.length - kept });
  }

  // OCR 配置三态：无效值会把该项清成 undefined（Object.assign 的既有行为），JSON 里该键整个消失。
  // 这条场景专门锁住「看起来像 bug、但必须照抄」的那个怪癖。
  {
    const capture = require('../lib/capture');
    // 与 main.js 启动同序：先用 kv 里的配置覆盖内存默认值。
    // C# 侧 ChanProbe.Run() 会 Boot.InitData() → Ocr.LoadFromKv()，同样从 kv 起步；
    // 不加载 kv 时两侧只是在"代码默认值恰好等于 kv 值"时偶然相等，改默认值就会假失败。
    const savedOcr = DB.kvGet ? DB.kvGet('ocr') : undefined;
    try {
      if (savedOcr && typeof savedOcr === 'object') capture.setOcrConfig(savedOcr);
    } catch (e) { /* 忽略 */ }
    emit('chan_ocr_cfg_default', capture.ocrConfig());
    emit('chan_ocr_cfg_set_invalid', capture.setOcrConfig({
      engine: ['auto', 'paddle', 'rapid', 'win', 'tess'].includes('no-such-engine') ? 'no-such-engine' : undefined,
      tier: ['medium', 'small', 'tiny'].includes('no-such-tier') ? 'no-such-tier' : undefined,
      python: typeof 42 === 'string' ? String(42).trim() : undefined,
    }));
    emit('chan_ocr_cfg_get_after_invalid', capture.ocrConfig());
    emit('chan_ocr_cfg_set_valid', capture.setOcrConfig({
      engine: ['auto', 'paddle', 'rapid', 'win', 'tess'].includes('win') ? 'win' : undefined,
      tier: ['medium', 'small', 'tiny'].includes('small') ? 'small' : undefined,
      python: '  C:\\py\\python.exe  '.trim(),
    }));
    // 新增可选通道 rapid（RapidOCR/ONNX）：白名单必须接受它（main.js 与 Ocr.Engines 同源）
    emit('chan_ocr_cfg_set_rapid', capture.setOcrConfig({
      engine: ['auto', 'paddle', 'rapid', 'win', 'tess'].includes('rapid') ? 'rapid' : undefined,
      tier: 'medium',
      python: '',
    }));
    emit('chan_ocr_cfg_get_after_rapid', capture.ocrConfig());
    // 还原内存配置（探针不留痕）
    capture.setOcrConfig({ engine: 'auto', tier: 'medium', python: '' });
    if (savedOcr !== undefined) DB.kvSet('ocr', savedOcr);
  }

  // OCR 解释器探测：候选路径顺序纯确定性，可严格对拍
  emit('chan_ocr_findpython', require('../lib/py').findPython('') || '');

  // 噪声行判定（纯函数）
  {
    const noise = require('../lib/noise');
    const samples = ['医嘱名称', '规格 剂量 频次 首日', '---', '| |', '21', '因', '否', '无', '男',
      '1克*1g/g', '10g*1g/g', '党参 20g', '舌淡胖边有齿痕，苔薄白，脉沉细。', ''];
    emit('chan_noise_lines', samples.map(t => ({ t, noise: noise.isNoiseLine(t) })));
  }

  // 自动辨证（纯函数）：诊断命中文本 + 症状投票 + 证型反查
  {
    const autosynd = require('../lib/autosynd');
    const diags = clinicalKb.list(KIND_DIAG);
    const sxs = clinicalKb.list(KIND_SX);
    const samples = [
      ['门诊病历\n主诉：胃脘隐痛反复发作3月，加重1周。\n现病史：喜温喜按，进食后缓解，伴腹胀、纳差、乏力。\n舌淡胖边有齿痕，苔薄白，脉沉细。\n诊断：胃脘痛\n证型：脾胃虚寒证',
        { 中医诊断: '胃脘痛 ', 证型: '脾胃虚寒证' }],
      ['长期医嘱单\n中医诊断：胸痹（心血瘀阻证）\n丹参 15g 川芎 10g 红花 6g',
        { 中医诊断: '胸痹', 证型: '心血瘀阻证' }],
      ['主诉：咳嗽咽痒1周，遇冷加重，痰白清稀。\n舌淡红苔薄白，脉浮紧。', {}],
      ['体检摘要：血压 138/86mmHg，心率 76次/分，近期时有心悸、气短。', {}],
      // 自由证名（未入 GB/T 证候库）：标注证型直接采信（keys 次强来源）
      ['临床诊断及证型：乳腺肿瘤,多汗疖,乳岩,汗病,痰瘀阳络证,昂热\nR',
        { 中医诊断: '乳腺肿瘤、多汗疖、乳岩、汗病、昂热', 证型: '痰瘀阳络证' }],
      // 标注证型为空 → 不得凭空采信
      ['临床诊断及证型：乳腺肿瘤,多汗疖\nR', { 中医诊断: '乳腺肿瘤、多汗疖', 证型: '' }],
    ];
    emit('chan_autosynd_judge', samples.map(([text, keys]) => autosynd.judge(text, keys, diags, sxs)));
    // 由方推证：文本无证型标注但命中方剂 → 方剂主治证型弱推断（与诊断证型池交集优先）
    const fSamples = [
      ['中医诊断：乳岩\n补中益气汤加减\n黄芪30g 党参15g 白术12g 当归12g 陈皮10g', { 中医诊断: '乳岩' }],
      ['补中益气汤加减\n黄芪30g 党参15g', {}],
      ['诊断：胃脘痛\n香砂六君子汤加减\n木香6g 砂仁6g 党参12g 白术9g 茯苓9g', { 中医诊断: '胃脘痛' }],
    ];
    emit('chan_autosynd_formula', fSamples.map(([text, keys]) => autosynd.judge(text, keys, diags, sxs)));
  }

  // 导出：对话框一律取消 → 锁住取消分支（不写文件、不碰磁盘）
  emit('chan_export_record_cancel', (() => {
    const rec = store.get(TEMP_ID);
    if (!rec) return { ok: false, error: '记录不存在' };
    return { ok: false, canceled: true };
  })());
  emit('chan_export_txt_cancel', (() => {
    const list = [TEMP_ID].map(id => store.get(id)).filter(Boolean);
    if (!list.length) return { ok: false, error: '无可导出的记录' };
    list.sort((a, b) => new Date(a.ts) - new Date(b.ts));
    return { ok: false, canceled: true };
  })());
  emit('chan_export_txt_empty', (() => {
    const list = [].map(id => store.get(id)).filter(Boolean);
    if (!list.length) return { ok: false, error: '无可导出的记录' };
    return { ok: false, canceled: true };
  })());

  // 演示数据：逐字照抄 main.js 的 panel:seedDemo，跑完按差集删除新增记录。
  // 对拍内容做过投影：ts 基于 now 两侧必然不同，故只比 source/winTitle/patient/diag/synd/
  // 脱敏后文本/是否已分析/keys 这些确定性字段，并按 (source|text) 排序消除库序差异。
  {
    const before = new Set(store.list().map(r => r.id));
    const now = Date.now();
    const H = 3600 * 1000, D = 24 * H;
    const mk = (o) => {
      const text = Analyze.maskText ? Analyze.maskText(o.raw) : o.raw;
      let sections = [];
      try { sections = Analyze.splitIntoSections(text, {}); } catch (e) { }
      const rec = store.add({
        source: o.source, winTitle: o.title || '', text, rawText: o.raw, sections,
        ts: new Date(now - o.ago).toISOString(),
        patient: o.patient || '', diag: o.diag || '', synd: o.synd || '',
        dept: o.dept || '', demo: true
      });
      if (o.analyzed) {
        try {
          const r2 = analyzeRecord(rec, { diag: o.diag, synd: o.synd });
          return store.patch(rec.id, { compliance: r2.compliance, tcm: r2.tcm, analyzedAt: new Date().toISOString() });
        } catch (e) { return rec; }
      }
      return rec;
    };
    const demos = [
      { dept: '脾胃病科', source: 'window', title: '门诊医生工作站', patient: '张某', diag: '胃脘痛', synd: '脾胃虚寒证', analyzed: true, ago: 3 * H,
        raw: '门诊病历\n姓名：张某  性别：女  年龄：38岁\n科别：脾胃病科\n主诉：胃脘隐痛反复发作3月，加重1周。\n现病史：患者3月前无明显诱因出现胃脘隐痛，喜温喜按，进食后缓解，伴腹胀、纳差、乏力，夜寐欠安，二便调。\n查体：神清，腹软，中上腹轻压痛，舌淡胖边有齿痕，苔薄白，脉沉细。\n辅助检查：胃镜示慢性浅表性胃炎。\n诊断：胃脘痛\n证型：脾胃虚寒证\n处理：\n黄芪 15g 桂枝 9g 白芍 12g 生姜 6g\n大枣 10g 炙甘草 6g 饴糖 20g\n7剂，水煎服，日一剂，分两次温服。' },
      { dept: '脾胃病科', source: 'clipboard', title: '', patient: '张某', diag: '胃脘痛', synd: '脾胃虚寒证', analyzed: true, ago: 2 * D + 4 * H,
        raw: '门诊病历\n姓名：张某  性别：女  年龄：38岁\n科别：脾胃病科\n主诉：胃脘隐痛较前缓解，仍纳差乏力。\n现病史：服药7剂后胃痛明显减轻，腹胀减，纳食增加，夜寐安，二便调。\n舌淡胖，苔薄白，脉沉细。\n诊断：胃脘痛\n证型：脾胃虚寒证\n处理：守方微调\n黄芪 18g 桂枝 9g 白芍 12g 生姜 6g\n大枣 10g 炙甘草 6g 饴糖 20g 炒谷芽 15g\n14剂，水煎服，日一剂，分两次温服。' },
      { dept: '心病科', source: 'uia', title: '住院医生站 - 医嘱浏览', patient: '李某', diag: '胸痹', synd: '心血瘀阻证', analyzed: true, ago: D + 6 * H,
        raw: '长期医嘱单\n患者：李某  床号：12  住院号：2026-0901\n科室：心病科\n中医诊断：胸痹（心血瘀阻证）\n西医诊断：冠心病 稳定型心绞痛\n临方加工：\n丹参 15g 川芎 10g 红花 6g 桃仁 10g\n赤芍 10g 柴胡 9g 桔梗 6g 牛膝 9g\n每日一剂 水煎 400ml 早晚分服' },
      { dept: '肺病科', source: 'region', title: '', patient: '王某', diag: '胁痛', synd: '肝郁脾虚证', analyzed: false, ago: 3 * D + 2 * H,
        raw: '处方笺\n王某 男 45岁\n科别：肺病科\n诊断：胁痛（肝郁脾虚证）\nRp：\n柴胡 10g 白术 10g 茯苓 12g 当归 10g\n白芍 12g 薄荷 6g 甘草 6g 香附 9g\n7剂 水煎服' },
      { dept: '肺病科', source: 'window', title: '门诊医生工作站', patient: '陈某', diag: '咳嗽', synd: '风寒袭肺证', analyzed: true, ago: 5 * D + 7 * H,
        raw: '门诊病历\n姓名：陈某 性别：男 年龄：56岁\n科别：肺病科\n主诉：咳嗽咽痒1周，遇冷加重，痰白清稀。\n舌淡红苔薄白，脉浮紧。\n诊断：咳嗽\n证型：风寒袭肺证\n处理：宣肺散寒止咳\n麻黄 6g 杏仁 9g 紫苏叶 9g 前胡 9g\n桔梗 6g 陈皮 6g 炙甘草 6g\n5剂，水煎服，日一剂。' },
      { dept: '骨伤科', source: 'window', title: '门诊医生工作站', patient: '赵某', diag: '骨折病', synd: '气滞血瘀证', analyzed: true, ago: 9 * D,
        raw: '门诊病历\n姓名：赵某 性别：男 年龄：42岁\n科别：骨伤科\n主诉：右踝扭伤肿痛3天。\n查体：右外踝肿胀压痛，活动受限，舌暗红苔薄白，脉弦涩。\n诊断：骨折病\n证型：气滞血瘀证\n处理：\n桃仁 10g 红花 6g 当归 12g 川芎 9g\n赤芍 12g 生地 12g 牛膝 9g 乳香 6g 没药 6g\n7剂 水煎服 日一剂' },
      { dept: '骨伤科', source: 'region', title: '', patient: '赵某', diag: '筋伤', synd: '气滞血瘀证', analyzed: true, ago: 12 * D,
        raw: '外用处方\n姓名：赵某 男 42岁\n科室：骨伤科\n诊断：筋伤（气滞血瘀证）\n海桐皮 15g 透骨草 15g 伸筋草 15g 红花 9g\n苏木 12g 艾叶 12g 川椒 6g\n3剂 水煎外洗患处 每日1剂' },
      { dept: '针灸推拿科', source: 'clipboard', title: '', patient: '孙某', diag: '腰痛', synd: '肝肾亏虚证', analyzed: true, ago: 18 * D,
        raw: '门诊处方\n孙某 女 63岁\n就诊科室：针灸推拿科\n中医诊断：腰痛\n证型：肝肾亏虚证\n独活 9g 桑寄生 15g 杜仲 9g 牛膝 12g\n细辛 3g 秦艽 9g 防风 9g 当归 12g\n白芍 12g 熟地黄 15g 党参 12g 茯苓 12g\n7剂 水煎服 每日1剂 早晚温服' },
      { dept: '脑病科', source: 'uia', title: '住院医生站 - 医嘱浏览', patient: '周某', diag: '眩晕', synd: '痰浊上扰证', analyzed: true, ago: 24 * D,
        raw: '长期医嘱单\n患者：周某 床号：8 住院号：2026-0815\n科室：脑病科\n中医诊断：眩晕（痰浊上扰证）\n西医诊断：后循环缺血\n法半夏 9g 白术 12g 天麻 9g 茯苓 15g\n陈皮 9g 泽泻 9g 生姜 6g 炙甘草 6g\n每日1剂 水煎 300ml 分两次服' },
      { dept: '脾胃病科', source: 'region', title: 'HIS 处方录入', patient: '吴某', diag: '胃痞', synd: '寒热错杂证', analyzed: true, ago: 31 * D,
        raw: '处方笺\n吴某 男 51岁\n科室：脾胃病科\n诊断：胃痞（寒热错杂证）\nRp：\n制附子 10g 法半夏 10g 黄连 6g 黄芩 9g\n干姜 6g 党参 12g 大枣 10g 炙甘草 6g\n14剂 水煎服 日一剂' },
      { dept: '心病科', source: 'region', title: '', patient: '郑某', diag: '心悸', synd: '', analyzed: true, ago: 44 * D,
        raw: '处方笺\n郑某 女 58岁\n科室：心病科\n诊断：心悸\nRp：\n炙甘草 30g 桂枝 12g 生地黄 15g 麦冬 12g\n阿胶 9g 火麻仁 10g 生姜 9g 大枣 10g\n10剂 水煎服' },
      { dept: '脑病科', source: 'region', title: '', patient: '冯某', diag: '不寐', synd: '心脾两虚证', analyzed: false, ago: 58 * D,
        raw: '处方笺\n冯某 女 47岁\n科室：脑病科\n诊断：不寐（心脾两虚证）\nRp：\n酸枣仁 柏子仁 远志 当归\n党参 黄芪 白术 茯苓\n龙眼肉 木香 炙甘草\n水煎服' },
      { dept: '骨伤科', source: 'clipboard', title: '', patient: '刘某', diag: '', synd: '', analyzed: false, ago: 72 * D,
        raw: '体检摘要：刘某 男 60岁\n科室：骨伤科\n血压 138/86mmHg，心率 76次/分\n近期时有心悸、气短，活动后加重，休息可缓解。\n建议：心内科门诊随诊。' }
    ];
    const added = demos.map(mk);
    // 探针不留痕：不删库里既有的 demo:true 记录（那是用户真实点出来的），replaced 恒为 0
    emit('chan_seed_demo', { ok: true, count: added.length, replaced: 0 });

    const proj = (r) => ({
      source: r.source, winTitle: r.winTitle || '', patient: r.patient || '',
      diag: r.diag || '', synd: r.synd || '', dept: r.dept || '', text: r.text,
      analyzed: !!(r.compliance || r.tcm), keys: r.keys || {},
    });
    const fresh = store.list().filter(r => !before.has(r.id)).map(proj);
    // 用码位比较而非 localeCompare：中文排序在 ICU 与 .NET 之间对多音字选音不同，
    // 这里只需要一个两侧确定一致的排序键，不涉及语言学语义。
    fresh.sort((a, b) => {
      const x = a.source + '|' + a.text, y = b.source + '|' + b.text;
      return x < y ? -1 : x > y ? 1 : 0;
    });
    emit('chan_seed_demo_records', fresh);
    for (const r of store.list()) if (!before.has(r.id)) store.remove(r.id); // 探针不留痕
  }

  // 质检拦截链路（放最后：会改写 TEMP 记录文本）——缺剂量 → analyze 被拦截；force=1 → 放行
  // 与 main.js record:analyze 完全同构（含 qc 前置判定与 force 分支）
  store.patch(TEMP_ID, { text: '处方：\n黄芪 15g\n党参\n白术 10g', rawText: '处方：\n黄芪 15g\n党参\n白术 10g' });
  emit('chan_analyze_blocked', hAnalyze({ id: TEMP_ID }));
  emit('chan_analyze_force', (() => {
    const r = hAnalyze({ id: TEMP_ID, force: 1, reason: '医师复核确认：缺剂量药味为抄录省略，剂量按原方执行' });
    // 摘要不含 forced.at（时间戳两侧必然不同）；hasForced/reason 证明留痕链路
    return r && r.ok ? { ok: true, qcLevel: r.qc && r.qc.level, errN: r.qc && r.qc.errN, focusN: r.focusN,
      hasForced: !!(r.qc && r.qc.forced), reason: (r.qc && r.qc.forced && r.qc.forced.reason) || '' } : r;
  })());
} catch (e) {
  // 单场景失败不应吞掉整轮：把异常记进 stderr，已收集的场景照常输出，
  // 缺失的场景会在 diff 阶段被指名报出。
  process.stderr.write('[probe] ' + ((e && e.stack) || e) + '\n');
} finally {
  store.remove(TEMP_ID);
  // ⚠ 最后一步才还原 kv.ai：ai.updateCfg 内部会 saveCfg() 落库，前面任何一次"还原"
  // 都会被后续用例的落库覆盖掉（曾把用户真实 API Key 顶成测试值）。
  if (savedAi !== undefined) { try { DB.kvSet('ai', savedAi); } catch (e) {} }
  process.stderr.write('[probe] kv.ai 还原: saved=' + (savedAi === undefined ? 'undefined' : JSON.stringify(savedAi).slice(0, 60))
    + ' | now=' + String(DB.kvGet('ai') ? JSON.stringify(DB.kvGet('ai')).slice(0, 60) : 'null') + '\n');
}
})().then(() => {
  process.stdout.write(out.join('\n') + '\n');
}).catch((e) => {
  process.stderr.write('[probe] fatal ' + ((e && e.stack) || e) + '\n');
  process.exit(1);
});
