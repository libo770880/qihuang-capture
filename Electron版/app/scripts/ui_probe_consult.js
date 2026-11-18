// UI 探针：辨证咨询窗 consult.html —— 验证分组折叠、滚动条、选择联动。
// 用真实运行库（只读）+ 真实 KB。输出 PROBE_JSON={...}
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { initClinicalKb, KIND_DIAG, KIND_SX } = require('../lib/clinicalkb');
const KB = require('../lib/kb');

const UD = path.join(os.homedir(), 'AppData', 'Roaming', '岐黄鉴方·悬浮采集助手');
const ckb = initClinicalKb(UD); // 已 seed 落盘，此处只读

ipcMain.handle('kb:consult-data', () => ({
  diagnoses: ckb.list(KIND_DIAG),
  symptoms: ckb.list(KIND_SX),
  syndromeRows: ckb.syndromeRows(),
  formulas: KB.getAllFormulas().map(f => ({ n: f.n, s: f.s || [], c: f.c, g: f.g, m: f.m, u: f.u, origin: f.origin, x: f.x || '' }))
}));
let lastAsk = null;
let callCount = 0;
ipcMain.handle('ai:run', (e, { kind, payload } = {}) => {
  callCount++;
  console.log('[probe] ai:run CALL#' + callCount + ' kind=' + kind + ' q=' + String((payload && payload.question) || '').slice(0, 24));
  lastAsk = { kind, q: (payload && payload.question) || '' };
  return { ok: true, kind: 'ask', answer: '### 病机\n本证为**热毒炽盛**所致。\n\n### 推荐方\n1. 犀角散（《备急千金要方》）\n2. 黄连解毒汤（《外台秘要》）\n\n### 加减\n- 高热加石膏\n- 神昏加安宫牛黄丸', refs: [{ kind: '方剂', name: '犀角散' }], mock: true, model: 'probe-mock' }
});

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1240, height: 760, show: false,
    webPreferences: { preload: path.join(UD === '' ? '' : path.join(__dirname, '..'), 'preload.js'), contextIsolation: true }
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer/consult.html'));
  const out = await win.webContents.executeJavaScript(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    await sleep(600);
    const r = {};
    // 1) 分组与滚动条
    r.diagGroups = Array.from(document.querySelectorAll('#diagBody .grph')).map(x => x.textContent.trim());
    r.grpCount = r.diagGroups.length;
    const body = document.getElementById('diagBody');
    r.diagScrollable = body.scrollHeight > body.clientHeight;
    r.overflowY = getComputedStyle(body).overflowY;
    // 折叠第一组再展开
    const g0 = document.querySelector('#diagBody .grp');
    const h0 = g0.clientHeight;
    g0.querySelector('.grph').click();
    await sleep(100);
    r.collapsedWorks = g0.clientHeight < h0;
    g0.querySelector('.grph').click();
    await sleep(100);
    // 2) 选诊断 → 证型池 + 症状联动
    pickDiag('咳嗽');
    await sleep(150);
    r.syndChips = document.querySelectorAll('#syndBody .chip.syn').length;
    r.syndChipsAreText = Array.from(document.querySelectorAll('#syndBody .chip.syn')).every(c => !c.textContent.includes('object'));
    r.relSection = (document.getElementById('gs0') || {}).textContent || 'MISSING';
    r.relChips = document.querySelectorAll('#gs0 .chip').length;
    r.relHighlighted = document.querySelectorAll('#gs0 .chip.rel').length;
    // 3) 选证型 → 症状相关区按证型刷新
    const syn = document.querySelector('#syndBody .chip.syn');
    const synName = syn ? syn.textContent : '';
    if (syn) syn.click();
    await sleep(150);
    r.pickedSynd = sel.synd;
    r.relAfterSynd = document.querySelectorAll('#gs0 .chip').length;
    r.selCurText = document.getElementById('selCur').textContent;
    r.goEnabled = !document.getElementById('goBtn').disabled;
    // 4) 症状分组存在
    r.sxGroups = Array.from(document.querySelectorAll('#sxBody .grph')).map(x => x.textContent.trim());
    r.sxScrollable = document.getElementById('sxBody').scrollHeight > document.getElementById('sxBody').clientHeight;
    // 5) 本地分析未命中 → 出现内联 AI 按钮（不自动调 AI）
    clearAll();
    await sleep(100);
    pickDiag('黄疸');
    await sleep(100);
    pickSynd('疫毒炽盛证');
    await sleep(100);
    r.aiBtnExists = !!document.getElementById('aiBtn');
    r.goLabel = document.getElementById('goBtn').textContent;
    r.aiBtnDisabledAtFirst = document.getElementById('aiBtn').disabled;
    await analyze();
    await sleep(150);
    r.inlineAiShown = !!document.querySelector('.ainline');
    r.noAutoBox = !document.querySelector('#res .aibox');
    return r;
  })()`);
  // 本地分析不应自动触发 AI
  console.log('[probe] P1 finished calls=', callCount);
  out.autoCalled = callCount === 0;
  const r2 = await win.webContents.executeJavaScript(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    // 6) 点内联 AI 按钮 → AI 分析 + Markdown 渲染
    document.querySelector('.ainline').click();
    await sleep(1200);
    const r = {};
    r.aiBoxShown = !!document.querySelector('#res .aibox');
    r.mdHeadingShown = !!document.querySelector('#res .aibox h3, #res .aibox h4, #res .aibox h5');
    r.mdListShown = document.querySelectorAll('#res .aibox li').length;
    r.mdBoldShown = !!document.querySelector('#res .aibox b');
    r.mdHeadHasAI = (document.getElementById('res').textContent || '').indexOf('AI 分析') >= 0;
    r.aiBtnRestored = document.getElementById('aiBtn').textContent === 'AI 分析';
    r.goRestored = document.getElementById('goBtn').textContent.indexOf('本地') === 0;
    return r;
  })()`);
  Object.assign(out, r2);
  console.log('[probe] P2 done calls=', callCount);
  out.askKind = lastAsk && lastAsk.kind;
  out.askHasSynd = !!(lastAsk && lastAsk.q.indexOf('疫毒炽盛证') >= 0);
  out.calls = callCount;
  console.log('PROBE_JSON=' + JSON.stringify(out, null, 1));
  app.exit(0);
}).catch(e => { console.error('PROBE_ERR', e); app.exit(1); });
