// UI 探针：病历类截图自动辨证（finalizeRecord 自动分析）在记录面板的三态渲染
// ① 病历+证型可判 → 结果区 + 绿色「证型诊断」条（诊断·证型·依据）
// ② 病历+证型未判 → 未定条 + 工作台按 an 预填诊断
// ③ 非病历 → 纯工作台（无预填、无结论条）
// ④ 「调整辨证」按钮 → 强制回工作台且预填当前值
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const { initClinicalKb, KIND_DIAG, KIND_SX } = require('../lib/clinicalkb');
const { runTcm, detectSyndromes, countRecordMarkers } = require('../lib/tcm');
const { runCompliance } = require('../lib/compliance');
const analyze = require('../lib/analyze');
const autosynd = require('../lib/autosynd');

const UD = path.join(os.homedir(), 'AppData', 'Roaming', '岐黄鉴方·悬浮采集助手');
const ckb = initClinicalKb(UD);
const DIAGS = ckb.list(KIND_DIAG);
const SYMS = ckb.list(KIND_SX);

// 用真实链路造三条记录（等价 finalizeRecord 逻辑，但不写盘）
function buildRecord(id, text, keys) {
  const masked = analyze.maskText(text);
  const sections = analyze.splitIntoSections(masked);
  const k = keys || analyze.extractKeyPoints(masked);
  const j = autosynd.judge(masked, k, DIAGS, SYMS);
  let compliance = null, tcm = null, an = null;
  if (j.record) {
    const over = {};
    if (j.diag) over.diag = j.diag;
    if (j.synd) over.synd = j.synd;
    const kk = Object.assign({}, k);
    if (over.synd) kk['证型'] = over.synd;
    if (over.diag) kk['中医诊断'] = over.diag;
    compliance = runCompliance({ text: masked, keys: kk, sections });
    tcm = runTcm({ text: masked, keys: kk, sections });
    an = { auto: true, diag: j.diag, synd: j.synd, syndSrc: j.syndSrc, evidence: j.evidence, candidates: j.candidates, diagHits: j.diagHits };
  }
  return { id, ts: new Date().toISOString(), source: 'window', winTitle: '探针', text: masked, rawText: text, sections, keys: k, compliance, tcm, an, ocr: [] };
}

const recSynd = buildRecord('r_synd',
  '中医诊断：咳嗽\n辨证：风寒袭肺证\n主诉：咳嗽3天，恶寒，痰白清稀。\n舌淡苔薄白，脉浮紧。\n方药：小青龙汤加减\n麻黄9g 桂枝9g 干姜9g 细辛3g 五味子6g 法半夏9g 白芍9g 炙甘草6g 杏仁10g',
  null);
const recNoSynd = buildRecord('r_nosynd',
  '中医诊断：咳嗽\n主诉：病程3天。\n舌淡红，苔薄白。', null);
const recNone = buildRecord('r_none', '布洛芬缓释胶囊 0.3g×20粒\n用法：每次1粒，每日2次。', null);

ipcMain.handle('panel:list', () => [recSynd, recNoSynd, recNone]);
ipcMain.handle('panel:get', (e, id) => [recSynd, recNoSynd, recNone].find(r => r.id === id) || null);
ipcMain.handle('panel:remove', () => true);
ipcMain.handle('panel:openImage', () => true);
ipcMain.handle('panel:openDir', () => true);
ipcMain.handle('panel:openConsult', () => true);
ipcMain.handle('ball:open-consult', () => true);
ipcMain.handle('panel:exportRecord', () => ({}));
ipcMain.handle('app:version', () => 'x');
ipcMain.handle('record:analyze', () => ({ ok: true, compliance: recSynd.compliance, tcm: recSynd.tcm, msg: 'ok' }));
ipcMain.handle('ai:run', () => ({ ok: true, markdown: '模拟', mock: true, model: 'probe' }));
ipcMain.handle('kb:clinical-list', (e, kind) => (kind === 'diag' ? DIAGS : SYMS));
ipcMain.handle('kb:clinical-stats', () => ckb.stats());
ipcMain.handle('gbt:stats', () => ({ total: 0 }));
ipcMain.handle('gbt:match-diag', () => []);
ipcMain.handle('gbt:search', () => ({ list: [] }));
ipcMain.handle('kb:consult-data', () => ({ diagnoses: DIAGS, symptoms: SYMS, syndromeRows: ckb.syndromeRows(), formulas: [] }));

app.whenReady().then(async () => {
  const ROOT = path.join(__dirname, '..');
  const preload = path.join(ROOT, 'preload.js');
  const win = new BrowserWindow({ width: 1380, height: 900, show: false, webPreferences: { preload, contextIsolation: true } });
  win.webContents.on('console-message', (e, lv, msg) => { if (String(msg).startsWith('[page]')) console.log(msg); });
  await win.loadFile(path.join(ROOT, 'renderer/panel.html'));
  const r = await win.webContents.executeJavaScript(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    await sleep(900);
    const out = {};
    const pick = i => { document.querySelectorAll('#list .rec')[i].click(); return sleep(450); };
    // ① 病历+证型
    await pick(0);
    out.s1 = {
      bar: !!document.querySelector('#an .synbar'),
      barClass: (document.querySelector('#an .synbar')||{className:''}).className,
      diagSynd: (document.querySelector('#an .synbar .sbm')||{textContent:''}).textContent.trim().slice(0, 30),
      evidence: (document.querySelector('#an .synbar .sbe')||{textContent:''}).textContent.trim().slice(0, 60),
      hasTcm: !!document.querySelector('#an .tcm'),
      hasComp: !!document.querySelector('#an .comp'),
      adjBtn: !!document.querySelector('#an .synbar .adj')
    };
    // ② 病历+证型未判
    await pick(1);
    out.s2 = {
      barMiss: (document.querySelector('#an .synbar')||{}).className === 'synbar miss',
      wbPrefill: (document.getElementById('wbDiagIn')||{value:''}).value,
      wbHint: ((document.querySelector('#an .wbs')||{textContent:''}).textContent||'').indexOf('预填') >= 0,
      dbg: (document.getElementById('an').innerHTML||'').slice(0, 200)
    };
    // ③ 非病历
    await pick(2);
    out.s3 = {
      noBar: !document.querySelector('#an .synbar'),
      wbEmpty: (document.getElementById('wbDiagIn')||{value:''}).value === ''
    };
    // ④ 调整辨证：回记录①点按钮 → 工作台且预填原值
    await pick(0);
    document.querySelector('#an .synbar .adj').click();
    await sleep(400);
    out.s4 = {
      wbShown: !!document.querySelector('#an .wb'),
      prefilled: (document.getElementById('wbDiagIn')||{value:''}).value,
      syndChips: document.querySelectorAll('#an .syndchip').length,
      syndOn: (document.querySelector('#an .syndchip.on')||{textContent:''}).textContent.trim()
    };
    return out;
  })()`);
  console.log('PROBE_JSON=' + JSON.stringify(r, null, 1));
  app.exit(0);
}).catch(e => { console.error('PROBE_ERR', e); app.exit(1); });
