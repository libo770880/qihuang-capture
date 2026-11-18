// UI 探针：手动分析链路
// ① panel：截图新记录→分析区为工作台(非结果)；选诊断/证型点本地分析→出方剂+合规；老记录直接展示。
// ② consult：带入截图上下文→命中诊断自动预选但【不自动分析】，文本条可清除。
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const { initClinicalKb, KIND_DIAG, KIND_SX } = require('../lib/clinicalkb');
const KB = require('../lib/kb');
const { runCompliance } = require('../lib/compliance');
const { runTcm } = require('../lib/tcm');
const analyze = require('../lib/analyze');

const UD = path.join(os.homedir(), 'AppData', 'Roaming', '岐黄鉴方·悬浮采集助手');
const ckb = initClinicalKb(UD); // 只读（已 seed）
const DIAGS = ckb.list(KIND_DIAG);
const SYMS = ckb.list(KIND_SX);

// ---- 模拟记录 ----
const freshRec = {
  id: 'r_new', ts: '2026-09-09T16:30:00.000Z', source: 'window', winTitle: '医院HIS-门诊',
  text: '中医诊断：咳嗽\n辨证：风寒袭肺证\n主诉：咳嗽3天。\n方药：小青龙汤加减\n麻黄9g 桂枝9g 干姜9g 细辛3g 五味子6g 法半夏9g 白芍9g 炙甘草6g 杏仁10g',
  rawText: '', sections: [], keys: { 中医诊断: '咳嗽', 证型: '风寒袭肺证' },
  compliance: null, tcm: null
};
const diagOnlyRec = {
  id: 'r_diag', ts: '2026-09-09T17:00:00.000Z', source: 'window', winTitle: '医院HIS-门诊',
  text: '中医诊断：咳嗽\n主诉：咳嗽3天，咯痰白稀。',
  rawText: '', sections: [], keys: { 中医诊断: '咳嗽' },
  compliance: null, tcm: null
};
const legacyRec = {
  id: 'r_old', ts: '2026-09-09T08:00:00.000Z', source: 'window',
  text: '中医诊断：感冒\n辨证：风热犯表证',
  rawText: '', sections: [], keys: {},
  compliance: { hasRecord: true, score: 90, grade: '良', items: [] },
  tcm: { ok: true, type: 'syndrome', typeLabel: '辨证' }
};
function analyzeMock(rec, over) {
  const keys = Object.assign({}, rec.keys || {});
  if (over && over.synd) keys['证型'] = over.synd;
  if (over && over.diag) keys['中医诊断'] = over.diag;
  const sections = analyze.splitIntoSections(rec.text);
  // 诊断 → 所属证型（与 main.js analyzeRecord 同逻辑）
  let diagSynds = [];
  const dn = String((over && over.diag) || keys['中医诊断'] || '').trim();
  const d = DIAGS.find(x => x && x.name && (x.name === dn || dn.includes(x.name) || x.name.includes(dn)));
  if (d) diagSynds = (d.syndromes || []).map(s => typeof s === 'string' ? s : (s && s.name) || '').filter(Boolean);
  return {
    ok: true,
    compliance: runCompliance({ text: rec.text, keys, sections }),
    tcm: runTcm({ text: rec.text, keys, sections, diagSynds }),
    msg: '本地分析完成'
  };
}
let panelCalls = 0;
ipcMain.handle('panel:list', () => [freshRec, diagOnlyRec, legacyRec]);
// 组成逐味药说明依赖中药库
ipcMain.handle('kb:list-all', () => ({ herbs: KB.getAllHerbs().map(h => ({ n: h.n, aliases: h.aliases || [], prop: h.prop, fx: h.fx })), formulas: [] }));
ipcMain.handle('panel:get', (e, id) => ([freshRec, diagOnlyRec, legacyRec].find(r => r.id === id) || null));
ipcMain.handle('panel:remove', () => true);
ipcMain.handle('panel:openImage', () => true);
ipcMain.handle('panel:openDir', () => true);
ipcMain.handle('panel:openConsult', () => true);
ipcMain.handle('ball:open-consult', () => true);
ipcMain.handle('panel:exportRecord', () => ({}));
ipcMain.handle('app:version', () => 'x');
ipcMain.handle('record:analyze', (e, p) => { panelCalls++; const rec = [freshRec, diagOnlyRec, legacyRec].find(r => r.id === p.id); return analyzeMock(rec || freshRec, { diag: p.diag, synd: p.synd }); });
ipcMain.handle('kb:clinical-list', (e, kind) => (kind === 'diag' ? DIAGS : SYMS));
ipcMain.handle('kb:clinical-stats', () => ckb.stats());
ipcMain.handle('kb:consult-data', () => ({
  diagnoses: DIAGS, symptoms: SYMS, syndromeRows: ckb.syndromeRows(),
  formulas: KB.getAllFormulas().map(f => ({ n: f.n, s: f.s || [], c: f.c, g: f.g, m: f.m, u: f.u, origin: f.origin, x: f.x || '' }))
}));
let ctx = { id: freshRec.id, ts: freshRec.ts, source: 'window', winTitle: '医院HIS-门诊', text: freshRec.text, charCount: freshRec.text.length };
let ctxCleared = false;
ipcMain.handle('consult:ctx', () => (ctxCleared ? null : ctx));
ipcMain.handle('consult:clear-ctx', () => { ctxCleared = true; return { ok: true }; });
let aiCalls = 0;
ipcMain.handle('ai:run', async (e, p) => { aiCalls++; return { ok: true, kind: 'record', markdown: '### AI解读\n- 完成', mock: true, mode: ['辨证推理'] }; });

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

app.whenReady().then(async () => {
  const out = {};
  const ROOT = path.join(__dirname, '..');
  const preload = path.join(ROOT, 'preload.js');
  const win = new BrowserWindow({ width: 1380, height: 900, show: false, webPreferences: { preload, contextIsolation: true } });
  win.webContents.on('console-message', (e, level, msg) => console.log('[page]', level, String(msg).slice(0, 160)));
  // ===== 1) 记录面板（手动分析模式） =====
  await win.loadFile(path.join(ROOT, 'renderer/panel.html'));
  const p1 = await win.webContents.executeJavaScript(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    await sleep(900);
    const r = {};
    r.rows = document.querySelectorAll('#list .rec').length;
    // 选中新记录 r_new（第一条）
    document.querySelectorAll('#list .rec')[0].click();
    await sleep(500);
    r.workbench = !!document.querySelector('#an .wb');
    r.noResultYet = !document.querySelector('#an .tcm') && !document.querySelector('#an .comp .ch');
    // 填诊断→出证型 chips
    const inp = document.getElementById('wbDiagIn');
    r.datalistN = document.querySelectorAll('#wbDiagL option').length; // 下拉应含全量诊断
    inp.value = '咳嗽'; inp.dispatchEvent(new Event('input'));
    await sleep(200);
    r.syndChips = document.querySelectorAll('#an .syndchip').length;
    if (r.syndChips) document.querySelectorAll('#an .syndchip')[0].click();
    await sleep(100);
    // 点本地分析
    document.getElementById('wbRun').click();
    await sleep(900);
    r.afterLocalHasTcm = !!document.querySelector('#an .tcm');
    r.afterLocalHasComp = !!document.querySelector('#an .comp');
    r.workbenchGone = !document.querySelector('#an .wb');
    // 新布局断言：处方在 #an 顶部、组成有逐味药块、推荐在独立容器且位于 AI 卡之后
    r.composeHerbBlocks = document.querySelectorAll('#an .cing .ci .cn').length;
    r.composeFirstHerb = (document.querySelector('#an .cing .ci .cn') || {}).textContent || '';
    r.anFirstCard = (document.querySelector('#an .fcard .fkind') || {}).textContent || '';
    r.recsAfterAi = (() => { const ai=document.getElementById('aiCard'), rh=document.getElementById('recsHost'); return !!(ai&&rh)&&(ai.compareDocumentPosition(rh)&Node.DOCUMENT_POSITION_FOLLOWING)===Node.DOCUMENT_POSITION_FOLLOWING; })();
    r.recsHostNoChosen = !document.querySelector('#recsHost .fcard.chosen');
    // 结果页应出现「本次分析依据」条 + 返回重选按钮
    r.resBar = !!document.querySelector('#an .synbar');
    r.resBarText = (document.querySelector('#an .synbar .sbm') || {}).textContent || '';
    const adjBtn = document.querySelector('#an .synbar .adj');
    r.resBarBtn = adjBtn ? adjBtn.textContent.trim() : '';
    if (adjBtn) {
      adjBtn.click();
      await sleep(500);
      r.backToWb = !!document.querySelector('#an .wb');
      r.backPrefillDiag = document.getElementById('wbDiagIn').value;
      r.backPrefillSynd = (document.querySelector('#an .syndchip.on') || {}).textContent || '';
      r.regenBtnLabel = document.getElementById('wbRun').textContent.trim();
      r.regenHint = (document.querySelector('#an .wbs') || {}).textContent || '';
      // 直接重新生成（沿用带入值）
      document.getElementById('wbRun').click();
      await sleep(900);
      r.regenHasTcm = !!document.querySelector('#an .tcm');
      r.regenBarText = (document.querySelector('#an .synbar .sbm') || {}).textContent || '';
    }
    // 仅诊断（不选证型）→ 按评分推荐方剂
    document.querySelectorAll('#list .rec')[1].click();
    await sleep(400);
    r.diagWb = !!document.querySelector('#an .wb');
    const inp2 = document.getElementById('wbDiagIn');
    inp2.value = '咳嗽'; inp2.dispatchEvent(new Event('input'));
    await sleep(200);
    document.getElementById('wbRun').click();
    await sleep(900);
    r.diagRecCards = document.querySelectorAll('#recsHost .fcard.rec').length;
    r.diagRecBadge = (document.querySelector('#recsHost .fcard.rec .bdg-rec') || {}).textContent || '';
    r.diagRecOk = /按诊断/.test(r.diagRecBadge) && /评分/.test(r.diagRecBadge);
    // 老记录直接展示
    document.querySelectorAll('#list .rec')[2].click();
    await sleep(400);
    r.legacyShowsTcm = !!document.querySelector('#an .tcm');
    r.legacyResBar = !!document.querySelector('#an .synbar');
    return r;
  })()`);
  Object.assign(out, { panel: p1, panelAnalyzeCalls: panelCalls, aiAutoCalls: aiCalls });
  await sleep(300);
  // ===== 2) 辨证咨询（带入上下文不自动分析） =====
  await win.loadFile(path.join(ROOT, 'renderer/consult.html'));
  const c1 = await win.webContents.executeJavaScript(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    await sleep(1000);
    const r = {};
    r.ctxStrip = (document.getElementById('ctxStrip').textContent || '').indexOf('已带入截图') >= 0;
    r.prefilledDiag = sel.diag;                       // 应为 咳嗽（命中预选）
    r.noAutoAnalyze = !document.querySelector('#res .fcard, #res .aibox, #res .msg'); // 结果区应为空(未自动分析)
    r.goDisabledBefore = document.getElementById('goBtn').disabled;   // 未选证型不可点
    // 点一个证型 → 本地分析可用
    const chips = document.querySelectorAll('#syndBody .chip.syn');
    r.syndVisible = chips.length > 0;
    if (chips.length) chips[0].click();
    await sleep(150);
    r.goEnabledAfter = !document.getElementById('goBtn').disabled;
    r.selCur = document.getElementById('selCur').textContent;
    return r;
  })()`);
  Object.assign(out, { consult: c1 });
  console.log('PROBE_JSON=' + JSON.stringify(out, null, 1));
  app.exit(0);
}).catch(e => { console.error('PROBE_ERR', e); app.exit(1); });
