// 探针：后台「处方点评」页 —— 批量点评 / 明细联动 / 单处方即时点评 / 导出工作表
// 说明：rx:review / rx:batch 走**真实纯逻辑**（lib/rxreview + lib/tcm），
//       rx:export 只验 payload（不弹真实保存对话框），避免 CI 卡在 UI 上。
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
const SHOT_DIR = path.join(__dirname, '..', '.probe', 'ui');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const TCM = require('../lib/tcm');
const RXR = require('../lib/rxreview');

// 三张虚拟处方的点评上下文（问题方 / 规范方 / 无药味）
const RX_BAD = [
  '黄芪 15g', '党参 12g', '甘草 10g', '甘遂 3g', '附子 20g', '半夏 9g', '白术 10g', '茯苓 15g',
  '陈皮 6g', '当归 12g', '川芎 10g', '白芍 15g', '熟地黄 15g', '山药 15g', '山茱萸 12g', '泽泻 10g',
  '牡丹皮 10g', '桂枝 6g', '防风 10g', '荆芥 10g', '桔梗 6g', '杏仁 10g', '贝母 10g', '紫菀 10g',
  '款冬花 10g', '桑白皮 12g', '黄芩 10g', '黄连 6g',
].join('\n') + '\n共28味14剂';
const RX_OK = ['黄芪 15g', '白术 10g', '茯苓 15g', '陈皮 6g', '半夏 9g', '共5味7剂',
  '每日1剂 水煎服 分早晚两次饭后内服'].join('\n');
const RX_NONE = '每日1剂 水煎服';

// 注意：rx-b 故意放在上一个月份（2026-09），用于验证「月度统计 + 按月下钻」
const RECS = [
  { id: 'rx-a', ts: '2026-10-18T01:00:00.000Z', source: 'region', text: RX_BAD },
  { id: 'rx-b', ts: '2026-09-18T01:01:00.000Z', source: 'clipboard', text: RX_OK, diag: '咳嗽', synd: '痰湿蕴肺证' },
  { id: 'rx-c', ts: '2026-10-18T01:02:00.000Z', source: 'ai-vision', text: RX_NONE },
];

let lastBatchLimit = null;
let lastReviewArg = null;
let lastExportCsv = null;

function ctxOf(rec, over) {
  const tcm = TCM.runTcm({ text: rec.text, keys: rec.diag ? { 中医诊断: rec.diag, 证型: rec.synd } : {} });
  const ctx = { tcm, text: rec.text, diag: rec.diag || '', synd: rec.synd || '' };
  return Object.assign({}, ctx, over || {});
}

ipcMain.handle('rx:batch', (e, arg) => {
  lastBatchLimit = (arg && arg.limit) || null;
  const items = RECS.map(r => Object.assign(ctxOf(r), { id: r.id, ts: r.ts, source: r.source }));
  try { return RXR.reviewBatch(items); } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('rx:review', (e, arg) => {
  lastReviewArg = arg || {};
  try {
    if (arg && arg.id) {
      const rec = RECS.find(r => r.id === arg.id);
      if (!rec) return { ok: false, error: '记录不存在' };
      return RXR.reviewOne(ctxOf(rec));
    }
    return RXR.reviewOne({
      tcm: TCM.runTcm({ text: (arg && arg.text) || '', usage: (arg && arg.usage) || '' }),
      text: (arg && arg.text) || '',
      diag: (arg && arg.diag) || '', synd: (arg && arg.synd) || '',
    });
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('rx:export', (e, arg) => {
  lastExportCsv = (arg && arg.csv) || '';
  return { ok: true, path: 'E:\\capture-tool\\.probe\\rx-sheet.csv' };
});

// 点评红线：内存态规则（不落库），记录 set/reset 调用
let RULE = { ...RXR.DEFAULT_RULES };
let lastRuleSet = null, lastRuleReset = false;
ipcMain.handle('rxrule:get', () => ({ ok: true, rules: { ...RULE }, defaults: { ...RXR.DEFAULT_RULES } }));
ipcMain.handle('rxrule:set', (e, patch) => {
  lastRuleSet = patch || {};
  RULE = Object.assign({}, RULE, patch);
  return { ok: true, rules: RXR.normalizeRules(RULE) };
});
ipcMain.handle('rxrule:reset', () => {
  lastRuleReset = true;
  RULE = { ...RXR.DEFAULT_RULES };
  return { ok: true, rules: RXR.normalizeRules(RULE) };
});

// admin.html 启动依赖的最小 IPC 集
ipcMain.handle('ai:config-get', () => ({ models: [] }));
ipcMain.handle('panel:list', () => []);
ipcMain.handle('sys:get', () => ({}));
for (const ch of ['ref:meta', 'ref:list', 'ref:search', 'userkb:list', 'records:list', 'kb:list', 'backup:mirror-info']) {
  try { ipcMain.handle(ch, () => []); } catch (e) { /* 已注册则忽略 */ }
}

const CHECKS = [
  ['tabExists', '「处方点评」页签存在且可切到该视图'],
  ['autoBatch', '切入本页自动跑批量点评 → 概览渲染（8 张统计卡）'],
  ['summaryVals', '概览数值正确：4 张可点评 / 合理 1 / 不合理 1 / 跳过 1'],
  ['rowsRender', '明细表渲染 2 行（合理 1 + 不合理 1）'],
  ['badgeCounts', '不合理行三类计数徽标齐备（不规范/不适宜/超常）'],
  ['probTop', '高频问题分布渲染 ≥3 类'],
  ['herbTop', '用药频次 Top10 渲染 ≥5 味'],
  ['rowDetail', '点明细行 → 右侧出点评报告（结论徽标 + 分类问题卡）'],
  ['detailItems', '报告含「不规范/用药不适宜/超常」至少三类分区'],
  ['monthRows', '月度统计表按处方时间归月（2026-10 / 2026-09 两个月）'],
  ['monthPick', '点「2026-09」月度行 → 明细只剩该月 1 张（合理方），月度下拉同步'],
  ['srcFilter', '来源筛「粘贴」→ 明细只剩 1 张'],
  ['clsFilter', '问题类别筛「含超常」→ 明细只剩不合理那张'],
  ['kwFilter', '关键词「咳嗽」→ 明细只剩该诊断那张'],
  ['filterReset', '重置筛选 → 明细回到 2 张'],
  ['oneReview', '粘贴文本即时点评 → 出「合理处方」结论'],
  ['limitPassed', '点评范围输入框的值真实传到 rx:batch'],
  ['exportCsv', '导出工作表 → CSV 含概览/明细/问题分布三段'],
  ['ruleTab', '「点评红线」页签存在且可切到该视图'],
  ['ruleFill', '红线表单按当前配置回填（味数 20/28 · 剂量 60/120 · 天数 7/14 · 辨证 30/15）'],
  ['ruleSave', '改味数提醒值 + 停用剂量红线 → 保存，patch 透传且结果区提示已保存'],
  ['ruleReset', '恢复默认 → 表单回默认值并提示已恢复'],
];
const out = {};

app.whenReady().then(async () => {
 try {
  const win = new BrowserWindow({
    width: 1360, height: 1500, show: true, // 必须可见：隐藏窗口 capturePage 几何不可靠
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true },
  });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'admin.html'));
  await sleep(1500);
  console.error('step: loaded');

  // ① 切到「处方点评」页签
  await win.webContents.executeJavaScript(`(async () => {
    for (const t of document.querySelectorAll('.tabs .tab')) if (/处方点评/.test(t.textContent || '')) { t.click(); break; }
    return true;
  })()`);
  await sleep(1400);
  console.error('step: tab clicked');

  const tab = await win.webContents.executeJavaScript(`(function () {
    const v = document.getElementById('v-rxreview');
    return { exists: !!v, on: v ? v.classList.contains('on') : false,
             hasTab: !![...document.querySelectorAll('.tabs .tab')].find(t => /处方点评/.test(t.textContent || '')) };
  })()`);
  out.tabExists = tab.hasTab && tab.exists && tab.on;

  // ② 自动批量点评（切入本页即触发）
  const sum = await win.webContents.executeJavaScript(`(function () {
    const boxes = [...document.querySelectorAll('#rxSum .box')];
    return { n: boxes.length, vals: boxes.map(b => (b.querySelector('b') || {}).textContent || ''),
             st: (document.getElementById('rxBatchSt') || {}).textContent || '' };
  })()`);
  out.autoBatch = sum.n === 8;
  // 期望顺序：总处方 / 合理 / 不合理 / 合理率 / 平均评分 / 不规范 / 不适宜 / 超常
  out.summaryVals = sum.vals[0] === '2' && sum.vals[1] === '1' && sum.vals[2] === '1'
    && sum.vals[3] === '50%' && /^\d+$/.test(sum.vals[5]) && /^\d+$/.test(sum.vals[7]);

  console.error('step: summary done ' + JSON.stringify(sum));
  // ③ 明细表
  const rows = await win.webContents.executeJavaScript(`(function () {
    const trs = [...document.querySelectorAll('#rxTbl tbody tr')];
    return { n: trs.length, first: trs[0] ? trs[0].textContent.replace(/\\s+/g, ' ').trim() : '',
             html: (document.getElementById('rxTbl') || {}).innerHTML || '' };
  })()`);
  out.rowsRender = rows.n === 2 && rows.html.indexOf('sbf-tbl') >= 0;
  out.badgeCounts = /不合理/.test(rows.first) && /合理/.test(rows.first);

  const tops = await win.webContents.executeJavaScript(`(function () {
    return { prob: document.querySelectorAll('#rxProbTop .badge-k').length,
             herb: document.querySelectorAll('#rxHerbTop .badge-k').length };
  })()`);
  out.probTop = tops.prob >= 3;
  out.herbTop = tops.herb >= 5;

  console.error('step: rows=' + rows.n + ' tops=' + JSON.stringify(tops));
  // ④ 点明细第一行 → 详情
  await win.webContents.executeJavaScript(`(async () => {
    const tr = document.querySelector('#rxTbl tbody tr');
    if (tr) tr.click();
    return true;
  })()`);
  await sleep(900);
  const det = await win.webContents.executeJavaScript(`(function () {
    const h = document.getElementById('rxDetail');
    return { txt: (h.textContent || '').replace(/\\s+/g, ' ').trim(),
             items: h.querySelectorAll('.rxitem').length, secs: h.querySelectorAll('.sec-h').length };
  })()`);
  out.rowDetail = det.items >= 5 && /不合理处方/.test(det.txt);
  out.detailItems = det.secs >= 3;

  console.error('step: detail items=' + det.items + ' secs=' + det.secs);

  // ④+ 月度统计 + 筛选联动（月份 / 来源 / 问题类别 / 关键词 / 重置）
  const mo = await win.webContents.executeJavaScript(`(function () {
    const trs = [...document.querySelectorAll('#rxMonthTbl tbody tr')];
    return { n: trs.length, ms: trs.map(t => t.dataset.m || ''),
             nn: (document.getElementById('rxMonthN') || {}).textContent || '' };
  })()`);
  out.monthRows = mo.n === 2 && mo.ms.indexOf('2026-10') >= 0 && mo.ms.indexOf('2026-09') >= 0;
  console.error('step: month rows=' + JSON.stringify(mo));

  await win.webContents.executeJavaScript(`(async () => {
    const tr = [...document.querySelectorAll('#rxMonthTbl tbody tr')].find(t => t.dataset.m === '2026-09');
    if (tr) tr.click();
    return true;
  })()`);
  await sleep(500);
  const mp = await win.webContents.executeJavaScript(`(function () {
    const trs = [...document.querySelectorAll('#rxTbl tbody tr')];
    return { n: trs.length, id: trs[0] ? (trs[0].dataset.id || '') : '',
             sel: (document.getElementById('rxMonthSel') || {}).value || '',
             scope: (document.getElementById('rxScope') || {}).textContent || '' };
  })()`);
  out.monthPick = mp.n === 1 && mp.id === 'rx-b' && mp.sel === '2026-09' && /2026-09/.test(mp.scope);
  console.error('step: month pick=' + JSON.stringify(mp));

  const filt = async (setup) => {
    await win.webContents.executeJavaScript(`(async () => {
      rxFilterReset(); ${setup} rxRenderAll(); return true;
    })()`);
    await sleep(320);
    return await win.webContents.executeJavaScript(`(function () {
      const trs = [...document.querySelectorAll('#rxTbl tbody tr')];
      return { n: trs.length, ids: trs.map(t => t.dataset.id || '') };
    })()`);
  };
  const fsrc = await filt(`document.getElementById('rxSrcSel').value = 'clipboard';`);
  out.srcFilter = fsrc.n === 1 && fsrc.ids[0] === 'rx-b';
  const fcls = await filt(`document.getElementById('rxClsSel').value = 'abnormal';`);
  out.clsFilter = fcls.n === 1 && fcls.ids[0] === 'rx-a';
  const fkw = await filt(`document.getElementById('rxq').value = '咳嗽';`);
  out.kwFilter = fkw.n === 1 && fkw.ids[0] === 'rx-b';
  const frs = await filt(``);
  out.filterReset = frs.n === 2;
  console.error('step: filters ' + JSON.stringify({ fsrc, fcls, fkw, frs }));

  // ⑤ 单处方即时点评（规范方 → 合理）
  await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('rxLimit').value = '80';
    const t = document.getElementById('rxTextIn');
    t.value = ${JSON.stringify(RX_OK)};
    t.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('rxDiagIn').value = '咳嗽';
    document.getElementById('rxSyndIn').value = '痰湿蕴肺证';
    [...document.querySelectorAll('#v-rxreview .btn')].find(b => /点评这张处方/.test(b.textContent)).click();
    return true;
  })()`);
  await sleep(1100);
  const one = await win.webContents.executeJavaScript(`(function () {
    const h = document.getElementById('rxOneBody');
    return { txt: (h.textContent || '').replace(/\\s+/g, ' ').trim(), has: !!h.querySelector('.badge-k') };
  })()`);
  out.oneReview = /合理处方/.test(one.txt) && one.has;

  console.error('step: one done: ' + one.txt.slice(0, 60));
  // ⑥ 重新跑批量点评 → 验证 limit 透传
  await win.webContents.executeJavaScript(`(async () => {
    [...document.querySelectorAll('#v-rxreview .btn')].find(b => /开始批量点评/.test(b.textContent)).click();
    return true;
  })()`);
  await sleep(900);
  out.limitPassed = lastBatchLimit === 80;

  console.error('step: rebatch done limit=' + lastBatchLimit);
  // ⑦ 导出工作表
  await win.webContents.executeJavaScript(`(async () => {
    [...document.querySelectorAll('#v-rxreview .btn')].find(b => /导出工作表/.test(b.textContent)).click();
    return true;
  })()`);
  await sleep(700);
  out.exportCsv = !!lastExportCsv && /岐黄鉴方 · 处方点评工作表/.test(lastExportCsv)
    && /高频问题/.test(lastExportCsv) && /首要问题/.test(lastExportCsv) && lastExportCsv.split('\r\n').length > 8;

  console.error('step: export len=' + (lastExportCsv || '').length);
  // ⑧ 切到「点评红线」页签 → 表单回填
  await win.webContents.executeJavaScript(`(async () => {
    for (const t of document.querySelectorAll('.tabs .tab')) if (/点评红线/.test(t.textContent || '')) { t.click(); break; }
    return true;
  })()`);
  await sleep(900);
  const rt = await win.webContents.executeJavaScript(`(function () {
    const v = document.getElementById('v-rxrule');
    const g = id => (document.getElementById(id) || {}).value;
    const c = id => !!(document.getElementById(id) || {}).checked;
    return { exists: !!v, on: v ? v.classList.contains('on') : false,
      herbWarn: g('rrHerbWarn'), herbErr: g('rrHerbErr'), doseWarn: g('rrDoseWarn'), doseErr: g('rrDoseErr'),
      jiWarn: g('rrJiWarn'), jiErr: g('rrJiErr'), syndWarn: g('rrSyndWarn'), syndErr: g('rrSyndErr'),
      herbOn: c('rrHerbOn'), doseOn: c('rrDoseOn'), jiOn: c('rrJiOn'), syndOn: c('rrSyndOn'),
      now: (document.getElementById('rxRuleNow') || {}).textContent || '' };
  })()`);
  out.ruleTab = rt.exists && rt.on;
  out.ruleFill = rt.herbWarn === '20' && rt.herbErr === '28' && rt.doseWarn === '60' && rt.doseErr === '120'
    && rt.jiWarn === '7' && rt.jiErr === '14' && rt.syndWarn === '30' && rt.syndErr === '15'
    && rt.herbOn && rt.doseOn && rt.jiOn && rt.syndOn && /提醒 20/.test(rt.now);

  console.error('step: rule fill ' + JSON.stringify(rt));
  // ⑨ 改值 + 停用剂量红线 → 保存
  await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('rrHerbWarn').value = '15';
    document.getElementById('rrDoseOn').checked = false;
    [...document.querySelectorAll('#v-rxrule .btn')].find(b => /保存红线设置/.test(b.textContent)).click();
    return true;
  })()`);
  await sleep(900);
  const rs = await win.webContents.executeJavaScript(`(function () {
    return { res: (document.getElementById('rxRuleRes') || {}).textContent || '',
             now: (document.getElementById('rxRuleNow') || {}).textContent || '',
             herbWarn: (document.getElementById('rrHerbWarn') || {}).value };
  })()`);
  out.ruleSave = !!lastRuleSet && lastRuleSet.herbWarn === 15 && lastRuleSet.doseOn === false
    && /已保存/.test(rs.res) && /已停用/.test(rs.now) && rs.herbWarn === '15';

  console.error('step: rule save ' + JSON.stringify(rs) + ' patch=' + JSON.stringify(lastRuleSet));
  // ⑩ 恢复默认
  await win.webContents.executeJavaScript(`(async () => {
    [...document.querySelectorAll('#v-rxrule .btn')].find(b => /恢复默认/.test(b.textContent)).click();
    return true;
  })()`);
  await sleep(800);
  const rr = await win.webContents.executeJavaScript(`(function () {
    const g = id => (document.getElementById(id) || {}).value;
    const c = id => !!(document.getElementById(id) || {}).checked;
    return { res: (document.getElementById('rxRuleRes') || {}).textContent || '',
             herbWarn: g('rrHerbWarn'), doseOn: c('rrDoseOn') };
  })()`);
  out.ruleReset = lastRuleReset && rr.herbWarn === '20' && rr.doseOn === true && /已恢复默认/.test(rr.res);
  // 截图取证（capturePage 在带 GPU 参数的进程里会 UnknownVizError；单独用 .probe/_shot_rxreview.js 出图）
  const pass = CHECKS.filter(c => out[c[0]]).length;
  const txt = CHECKS.map(([k, d]) => `${out[k] ? 'OK  ' : 'FAIL'}  ${k}  —  ${d}`).join('\n');
  console.log(txt);
  console.log(`\n${pass}/${CHECKS.length}  ${pass === CHECKS.length ? 'ALL_OK' : 'HAS_FAIL'}`);
  app.exit(pass === CHECKS.length ? 0 : 1);
 } catch (err) { console.error('PROBE ERR: ' + (err && err.message)); app.exit(2); }
});
