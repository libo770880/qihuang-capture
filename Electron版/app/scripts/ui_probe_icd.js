// UI 探针：加载后台 admin.html（真实 preload），mock kb IPC + 真实 icdmap 模块，
// 验证「编码对照」页签渲染、差异筛选、编码/名称检索。
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
// 可选 --data=<dir>：用真实 data.db 走「db 优先」路径（否则回落 JSON 兜底）
const argData = (process.argv.find(a => a.startsWith('--data=')) || '').slice(7);
if (argData) { try { require('../lib/db').initDb(argData, () => {}); } catch (e) { console.error('initDb failed:', e.message); } }
const icdmap = require('../lib/icdmap');

const ROOT = path.join(__dirname, '..');

ipcMain.handle('kb:stats', () => ({ formulaBuiltin: 179, herbBuiltin: 338, formulaUser: 0, herbUser: 0 }));
ipcMain.handle('kb:list-all', () => ({ herbs: [], formulas: [] }));
ipcMain.handle('kb:yibao-list', () => []);
ipcMain.handle('sys:get', () => ({}));
ipcMain.handle('kb:clinical-stats', () => ({ diagCount: 0, symptomCount: 0, symptomTcm: 0, symptomWest: 0, syndromeCount: 0 }));
ipcMain.handle('kb:clinical-list', () => []);
ipcMain.handle('kb:clinical-rows', () => []);
ipcMain.handle('gbt:stats', () => ({ total: 0, disease: { count: 0, cats: [] }, syndrome: { count: 0, cats: [] }, therapy: { count: 0, cats: [] } }));
ipcMain.handle('gbt:search', () => ({ list: [], truncated: false }));
ipcMain.handle('gbt:match-diag', () => []);
ipcMain.handle('icd:stats', () => icdmap.stats());
ipcMain.handle('icd:search', (e, { q = '', mode = 'all' } = {}) => icdmap.search(q, mode, 300));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1480, height: 920, show: false,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true }
  });
  await win.loadFile(path.join(ROOT, 'renderer/admin.html'));
  const out = await win.webContents.executeJavaScript(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    await sleep(500);
    const r = {};
    r.tabExists = !!document.querySelector('.tab[data-v="icd"]');
    // 进入编码对照页签
    switchView('icd');
    await sleep(800);
    r.total = document.getElementById('icdTotal').textContent;
    r.stI = document.getElementById('stI').textContent;
    r.diffCode = document.getElementById('icdDiffCode').textContent;
    r.diffName = document.getElementById('icdDiffName').textContent;
    r.itemCount = document.querySelectorAll('#icdItems .it').length;
    r.firstRowText = ((document.querySelector('#icdItems .it')||{}).textContent||'').slice(0,60);
    // 检索 I10
    document.getElementById('icdSearch').value = 'I10';
    await icdQuery();
    await sleep(200);
    r.i10Count = document.querySelectorAll('#icdItems .it').length;
    r.i10HasHyp = (document.getElementById('icdItems').textContent||'').indexOf('高血压') >= 0;
    // 仅看差异
    document.getElementById('icdSearch').value = '';
    icdModePick('diff', document.querySelector('#icdMode button:nth-child(2)'));
    await sleep(300);
    r.diffCount = document.querySelectorAll('#icdItems .it').length;
    r.diffHasDc = document.querySelectorAll('#icdItems .gcode.dc').length > 0;
    r.diffBadge = (document.getElementById('icdItems').textContent||'').indexOf('差异') >= 0;
    // 完全一致
    icdModePick('same', document.querySelector('#icdMode button:nth-child(3)'));
    await sleep(300);
    r.sameCount = document.querySelectorAll('#icdItems .it').length;
    r.sameNoDc = document.querySelectorAll('#icdItems .gcode.dc').length === 0;
    return r;
  })()`);
  console.log('PROBE_JSON=' + JSON.stringify(out, null, 1));
  app.exit(0);
});
