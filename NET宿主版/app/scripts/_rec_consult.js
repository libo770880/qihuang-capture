// scripts/_rec_consult.js - 「脉 辨证咨询」页演示动图（第17页用）
// 流程：选中医诊断 → 证型/相关症状联动 → 勾症状本地辨证 → 一键 AI 分析
// 用法：electron scripts/_rec_consult.js
const { app, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const { Recorder, openWin, sleep, OUT } = require('../lib/rec-core');
const { initClinicalKb, KIND_DIAG, KIND_SX } = require('../lib/clinicalkb');
const KB = require('../lib/kb');

const ROOT = path.join(__dirname, '..');
const UD = path.join(os.homedir(), 'AppData', 'Roaming', '岐黄鉴方·悬浮采集助手');
const log = (m) => console.log('[rec] ' + m);
require('../lib/db').initDb(UD, () => {}); // 先开库再读临床知识库（只读）

app.whenReady().then(async () => {
  const ckb = initClinicalKb(UD); // 只读
  ipcMain.handle('kb:consult-data', () => ({
    diagnoses: ckb.list(KIND_DIAG),
    symptoms: ckb.list(KIND_SX),
    syndromeRows: ckb.syndromeRows(),
    formulas: KB.getAllFormulas().map(f => ({ n: f.n, s: f.s || [], c: f.c, g: f.g, m: f.m, u: f.u, origin: f.origin, x: f.x || '' }))
  }));
  ipcMain.handle('consult:ctx', () => null);
  ipcMain.handle('consult:clear-ctx', () => ({ ok: true }));
  ipcMain.handle('kb:yibao-list', () => []);
  ipcMain.handle('kb:list-all', () => ({ herbs: KB.getAllHerbs() }));
  ipcMain.handle('tcm:west-candidates', () => []);
  ipcMain.handle('panel:get', () => null);
  ipcMain.handle('panel:patch', () => ({ ok: true }));
  ipcMain.handle('kb:clinical-upsert', () => ({ ok: true }));
  ipcMain.handle('ai:config-get', () => ({ hasKey: true, modelLabel: 'DeepSeek · deepseek-chat' }));
  ipcMain.handle('ai:run', () => ({
    ok: true, kind: 'ask', mock: true, model: 'demo-mock',
    refs: [{ kind: '方剂', name: '身痛逐瘀汤' }],
    answer: [
      '### 病机',
      '腰痛日久，**气滞血瘀**，经络不通，不通则痛。',
      '',
      '### 治法',
      '活血化瘀，行气止痛，兼以补肾强腰。',
      '',
      '### 推荐方',
      '1. **身痛逐瘀汤**（《医林改错》）——活血行气，通络止痛',
      '2. **肾着汤**合**杜仲川断**加减——温经散寒，补肾强腰',
      '',
      '### 加减',
      '- 痛甚加延胡索、乳香、没药',
      '- 腰膝酸软加桑寄生、狗脊',
      '- 兼寒象加独活、桂枝'
    ].join('\n')
  }));

  const win = await openWin('consult.html', 1100, 720);
  const r = new Recorder('16-脉辨证咨询', win, 10);
  const js = r.js;
  await js(`(async () => { await new Promise(s => setTimeout(s, 400)); return typeof pickDiag === 'function'; })()`);

  // 选骨伤科诊断（缺省回退）
  const diagOk = await js(`(() => { try { pickDiag('腰痛'); return sel.diag === '腰痛'; } catch (e) { return false; } })()`);
  if (!diagOk) await js(`(() => { pickDiag('咳嗽'); return 1; })()`);
  log('diag picked: ' + (diagOk ? '腰痛' : '咳嗽(回退)'));

  await r.start();
  r.mark('① 门诊开方遇辨证难题 → 打开「脉 辨证咨询」');
  await r.wait(1800);
  r.mark(diagOk ? '② 选中医诊断「腰痛」→ 证型池自动联动' : '② 选中医诊断 → 证型池自动联动');
  await r.wait(1600);
  // 选证型
  const syndPicked = await js(`(async () => {
    const c = document.querySelector('#syndBody .chip.syn');
    if (!c) return '';
    c.click(); await new Promise(s => setTimeout(s, 200));
    return (sel.synd) || '';
  })()`);
  r.mark('③ 选定证型 → 相关症状区高亮提示');
  await r.wait(1600);
  // 勾 2-3 个症状
  await js(`(async () => {
    const chips = Array.from(document.querySelectorAll('#sxBody .chip')).slice(0, 3);
    for (const c of chips) { c.click(); await new Promise(s => setTimeout(s, 250)); }
    return chips.length;
  })()`);
  r.mark('④ 勾选患者症状 → 点「本地辨证」');
  await r.click('#goBtn', { after: 1400 });
  r.mark('⑤ 本地辨证引擎给出证型判定与代表方');
  await r.wait(2600);
  r.mark('⑥ 需要展开分析 → 一键 AI 辨证（带知识库依据）');
  const aiClicked = await js(`(() => { const b = document.querySelector('.ainline') || document.getElementById('aiBtn'); if (!b) return false; b.click(); return true; })()`);
  if (!aiClicked) log('WARN: inline AI button not found');
  await r.wait(2200);
  r.mark('⑦ 输出病机 · 治法 · 推荐方 · 加减，全程可溯');
  await r.wait(2600);
  const meta = await r.stop();
  win.destroy();
  log('scene consult -> ' + JSON.stringify(meta));
  app.quit();
}).catch(e => { console.error(e); app.exit(1); });
