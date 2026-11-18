/**
 * UI 探针：人工复核条（renderer/review-bar.js）
 * ------------------------------------------------------------
 * 覆盖两处宿主：
 *   ① 辨证咨询窗 consult.html —— 由记录面板带记录进入时，分析结果弹窗顶部的复核条；
 *   ② 记录面板 panel.html     —— 记录详情区（回归：改造后口径与形态不能变）。
 *
 * 用真实 preload（不 mock window.qhjf 的形状），只 mock 三个主进程通道：
 *   kb:consult-data（辨证库） / consult:ctx（带入的记录上下文） / panel:get / panel:patch
 * 造一条「已核查·有提示」的记录（tcm.rx.warnN>0 且 errorN=0、无 diagCheck.weak），
 * 走真实用户路径：选诊断 → 选证型 → 本地分析 → 弹窗内点 驳回/改判/撤销。
 *
 * 用法：<electron> scripts/ui_probe_review.js
 * 输出：PROBE_JSON={...} + 逐项 OK/FAIL
 */
'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
app.disableHardwareAcceleration();
// 探针要连开两个窗：订阅该事件可取消 Electron「关完所有窗就退出」的默认行为
app.on('window-all-closed', () => { });
const { initClinicalKb, KIND_DIAG, KIND_SX } = require('../lib/clinicalkb');
const KB = require('../lib/kb');
const DB = require('../lib/db');

const UD = path.join(os.homedir(), 'AppData', 'Roaming', '岐黄鉴方·悬浮采集助手');
DB.initDb(UD);            // 临床库从 SQLite 读，必须先开户
const ckb = initClinicalKb(UD); // 已 seed 落盘，此处只读

ipcMain.handle('kb:consult-data', () => ({
  diagnoses: ckb.list(KIND_DIAG),
  symptoms: ckb.list(KIND_SX),
  syndromeRows: ckb.syndromeRows(),
  formulas: KB.getAllFormulas().map(f => ({ n: f.n, s: f.s || [], c: f.c, g: f.g, m: f.m, u: f.u, origin: f.origin, x: f.x || '' }))
}));

// —— 待裁定记录：合规通过但有 2 项提示 → sealCls==='warn'（唯一需要人工裁定的状态）——
const REC = {
  id: 'rv-probe-0001',
  ts: '2026-10-17T02:10:00.000Z',
  source: 'window',
  winTitle: '住院医生工作站 · 张三',
  patient: '张三',
  text: '患者咳嗽痰白清稀，怕冷，舌淡苔白，脉浮紧。处方：小青龙汤加减。',
  charCount: 33,
  keys: { 姓名: '张三' },
  compliance: { hasRecord: true, errorN: 0, warnN: 1, items: [] },
  tcm: {
    rx: { errorN: 0, warnN: 1, items: [] },
    diagCheck: { level: 'ok' },
    chosen: [],
    herbs: [{ name: '麻黄', dose: 9 }]
  }
};
let patches = [];
ipcMain.handle('panel:get', (_e, id) => (id === REC.id ? JSON.parse(JSON.stringify(REC)) : null));
ipcMain.handle('panel:patch', (_e, { id, patch } = {}) => {
  patches.push({ id, patch: JSON.parse(JSON.stringify(patch || null)) });
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'review')) {
    if (patch.review) REC.review = patch.review; else delete REC.review;
  }
  return { ok: true, rec: JSON.parse(JSON.stringify(REC)) };
});
ipcMain.handle('consult:ctx', () => ({
  id: REC.id, ts: REC.ts, source: REC.source, winTitle: REC.winTitle,
  text: REC.text, charCount: REC.text.length
}));

const CHECKS = [
  ['consult.ctxLoaded', '辨证咨询窗取到了带入的记录'],
  ['consult.modalOpen', '本地分析后弹出结果弹窗 #rmb'],
  ['consult.rvbarShown', '弹窗顶部挂出人工复核条 .rvbar'],
  ['consult.rvbarWarnText', '复核条文案含「机器核查：合规通过 · 2 项提示待裁定」'],
  ['consult.rvbarStyled', '复核条样式已注入（左边框 3px 琥珀色 + 圆角 10px）'],
  ['consult.askShown', '点「✕ 驳回」后出现驳回原因输入框 #rvNote'],
  ['consult.noteFocused', '输入框自动聚焦（Enter 即可提交）'],
  ['consult.rejectCls', '确认驳回后复核条变红标 .rvbar.rej'],
  ['consult.rejectNote', '驳回原因留痕并回显（原因：剂量偏大，请复核）'],
  ['consult.patchReject', '落库：panel:patch 收到 review={status:reject,note}'],
  ['consult.passCls', '点「改为通过并存档」后复核条变绿标 .rvbar.pass'],
  ['consult.patchPass', '落库：panel:patch 收到 review={status:pass}'],
  ['consult.passHint', '通过后提示「已存档 · 默认列表已隐去」'],
  ['consult.clearBack', '撤销裁定后回到初始待裁定态'],
  ['consult.patchClear', '落库：panel:patch 收到 review:null（落库删键）'],
  ['consult.contentKept', '裁定过程不破坏弹窗内已有分析结果（方剂卡仍在）'],
  ['panel.pRvbarShown', '记录面板详情区仍有复核条（回归）'],
  ['panel.pRvbarStyled', '记录面板复核条样式一致（同一份注入 CSS）'],
  ['panel.pSealCounts', '面板口径函数未漂移：sealCls===warn / warn 数=2'],
  ['panel.pCssInjected', '复核条 CSS 由 review-bar.js 注入（#rvbar-css）']
];

app.whenReady().then(async () => {
  const out = {};
  // ================= ① 辨证咨询窗 =================
  const win = new BrowserWindow({
    width: 1240, height: 820, show: false,
    backgroundColor: '#f4f7f5',
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true }
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'consult.html'));

  const c = await win.webContents.executeJavaScript(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const r = {};
    await sleep(700);
    r.ctxLoaded   = !!rvRec && rvRec.id === 'rv-probe-0001';
    // 真实用户路径：选诊断 → 选证型 → 点「本地分析」
    pickDiag('咳嗽'); await sleep(120);
    const syn = document.querySelector('#syndBody .chip.syn');
    if (syn) syn.click();
    await sleep(120);
    await analyze(); await sleep(250);
    r.modalOpen   = !!document.getElementById('rmb');
    r.fcards      = document.querySelectorAll('#rmb .fcard').length;
    const bar = document.querySelector('#rmb .rvbar');
    r.rvbarShown  = !!bar;
    r.rvbarText   = bar ? bar.textContent.replace(/\\s+/g, ' ').trim() : '';
    r.rvbarWarnText = /机器核查：合规通过 · 2 项提示待裁定/.test(r.rvbarText);
    if (bar) {
      const cs = getComputedStyle(bar);
      r.rvbarCss = { blw: cs.borderLeftWidth, br: cs.borderRadius, blc: cs.borderLeftColor, bg: cs.backgroundColor };
      // 用「左边框 / 上边框」比值断言（3 倍），避免受窗口 zoomFactor 影响
      const ratio = parseFloat(cs.borderLeftWidth) / (parseFloat(cs.borderTopWidth) || 1);
      r.rvbarStyled = Math.abs(ratio - 3) < 0.05 && parseFloat(cs.borderRadius) >= 8
                   && cs.borderLeftColor === 'rgb(185, 118, 15)';
    }
    return r;
  })()`);
  Object.assign(out, c);

  // 驳回：点 ✕ 驳回 → 填原因 → 确认驳回
  const c2 = await win.webContents.executeJavaScript(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const r = {};
    document.querySelector('#rmb .rvbar button.no').click();
    await sleep(150);
    r.askShown = !!document.getElementById('rvNote');
    r.noteFocused = document.activeElement && document.activeElement.id === 'rvNote';
    const inp = document.getElementById('rvNote');
    if (inp) inp.value = '剂量偏大，请复核';
    [...document.querySelectorAll('#rmb .rvbar button')].find(b => b.textContent.includes('确认驳回')).click();
    await sleep(400);
    const bar = document.querySelector('#rmb .rvbar');
    r.rejectCls = !!bar && bar.classList.contains('rej');
    r.rejectText = bar ? bar.textContent.replace(/\\s+/g, ' ').trim() : '';
    r.rejectNote = /原因：剂量偏大，请复核/.test(r.rejectText);
    return r;
  })()`);
  Object.assign(out, c2);
  out['consult.patchReject'] = !!(patches[0] && patches[0].patch && patches[0].patch.review
    && patches[0].patch.review.status === 'reject' && patches[0].patch.review.note === '剂量偏大，请复核');

  // 改判通过 → 撤销
  const c3 = await win.webContents.executeJavaScript(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const r = {};
    [...document.querySelectorAll('#rmb .rvbar button')].find(b => b.textContent.includes('改为通过并存档')).click();
    await sleep(400);
    const bar = document.querySelector('#rmb .rvbar');
    r.passCls = !!bar && bar.classList.contains('pass');
    r.passText = bar ? bar.textContent.replace(/\\s+/g, ' ').trim() : '';
    r.passHint = /已存档/.test(r.passText) && /默认列表隐去/.test(r.passText);
    [...document.querySelectorAll('#rmb .rvbar button')].find(b => b.textContent.includes('撤销裁定')).click();
    await sleep(400);
    const bar2 = document.querySelector('#rmb .rvbar');
    r.clearBack = !!bar2 && !bar2.classList.contains('pass') && !bar2.classList.contains('rej')
               && /机器核查：合规通过 · 2 项提示待裁定/.test(bar2.textContent.replace(/\\s+/g, ' '));
    r.contentKept = document.querySelectorAll('#rmb .fcard').length;
    return r;
  })()`);
  Object.assign(out, c3);
  out['consult.patchPass'] = !!(patches[1] && patches[1].patch && patches[1].patch.review && patches[1].patch.review.status === 'pass');
  out['consult.patchClear'] = !!(patches[2] && patches[2].patch && patches[2].patch.review === null);
  out['consult.contentKept'] = out.fcards > 0 && c3.contentKept === out.fcards;

  // 取证截图
  const shot1 = path.join(__dirname, '..', '.probe', 'ui');
  fs.mkdirSync(shot1, { recursive: true });
  await win.setSize(1240, 820);
  await win.webContents.executeJavaScript(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('#rmb .rvbar button')].find(b => b.textContent.includes('✕ 驳回')).click();
    await sleep(200);
  })()`);
  await new Promise(r => setTimeout(r, 300));
  const imgPath = path.join(shot1, 'consult-review.png');
  const img = await win.webContents.capturePage();
  fs.writeFileSync(imgPath, img.toPNG());
  console.log('[probe] 截图 → ' + imgPath);
  win.destroy();
  await new Promise(r => setTimeout(r, 800));   // 销毁后再开新窗，避免竞态导致 loadFile 失败

  // ================= ② 记录面板（回归） =================
  const win2 = new BrowserWindow({
    width: 1440, height: 900, show: false,
    backgroundColor: '#f4f7f5',
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true }
  });
  // 面板从 panel:list 取记录；这里只放造好的那一条
  ipcMain.handle('panel:list', () => [JSON.parse(JSON.stringify(Object.assign({}, REC, { review: null })))]);
  await win2.loadFile(path.join(__dirname, '..', 'renderer', 'panel.html'));
  const p = await win2.webContents.executeJavaScript(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const r = {};
    await sleep(1500);
    const cards = document.querySelectorAll('.rec');
    r.pRecCount = cards.length;
    if (cards[0]) cards[0].click();
    await sleep(500);
    const bar = document.querySelector('.dwrap .rvbar');
    r.pRvbarShown = !!bar;
    r.pRvbarText = bar ? bar.textContent.replace(/\\s+/g, ' ').trim() : '';
    if (bar) {
      const cs = getComputedStyle(bar);
      r.pRvbarCss = { blw: cs.borderLeftWidth, br: cs.borderRadius, blc: cs.borderLeftColor, bg: cs.backgroundColor };
      const ratio = parseFloat(cs.borderLeftWidth) / (parseFloat(cs.borderTopWidth) || 1);
      r.pRvbarStyled = Math.abs(ratio - 3) < 0.05 && parseFloat(cs.borderRadius) >= 8
                    && cs.borderLeftColor === 'rgb(185, 118, 15)';
    }
    r.pSealCounts = (typeof sealCls === 'function') && sealCls(cur) === 'warn' && sealCounts(cur).warn === 2;
    r.pCssInjected = !!document.getElementById('rvbar-css');
    return r;
  })()`);
  Object.assign(out, p);
  const img2 = await win2.webContents.capturePage();
  fs.writeFileSync(path.join(shot1, 'panel-review.png'), img2.toPNG());
  console.log('[probe] 截图 → ' + path.join(shot1, 'panel-review.png'));
  win2.destroy();

  // ================= 汇总 =================
  console.log('PROBE_JSON=' + JSON.stringify(out, null, 1));
  let ok = 0;
  console.log('\n———— 人工复核条探针 ————');
  CHECKS.forEach(([k, desc]) => {
    const v = out[k] !== undefined ? out[k] : out[k.split('.').pop()];
    const pass = !!v;
    if (pass) ok++;
    console.log((pass ? '  OK  ' : ' FAIL ') + k + '  ' + desc);
  });
  console.log(`\n结果：${ok}/${CHECKS.length}` + (ok === CHECKS.length ? '  ALL_OK' : '  有失败项'));
  app.exit(0);
});
