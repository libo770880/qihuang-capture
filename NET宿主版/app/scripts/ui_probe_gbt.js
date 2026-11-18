// UI 探针：加载后台 admin.html（真实 preload），mock kb/clinical IPC + 真实 gbt 模块，
// 验证「国家标准」页签渲染、分库切换、检索与辨证库国标徽标。
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
// 可选 --data=<dir>：用真实 data.db 走「db 优先」路径（否则回落 JSON 兜底）
const argData = (process.argv.find(a => a.startsWith('--data=')) || '').slice(7);
if (argData) { try { require('../lib/db').initDb(argData, () => {}); } catch (e) { console.error('initDb failed:', e.message); } }
const gbt = require('../lib/gbt');

const ROOT = path.join(__dirname, '..');
const DIAG = [{ name: '感冒', cat: '内科', syndromes: ['表虚证', '风寒束表证'], note: '测试条目' }];

ipcMain.handle('kb:stats', () => ({ formulaBuiltin: 170, herbBuiltin: 338, formulaUser: 0, herbUser: 0 }));
ipcMain.handle('kb:list-all', () => ({ herbs: [], formulas: [] }));
ipcMain.handle('kb:yibao-list', () => []);
ipcMain.handle('sys:get', () => ({}));
ipcMain.handle('kb:clinical-stats', () => ({ diagCount: DIAG.length, symptomCount: 0, symptomTcm: 0, symptomWest: 0, syndromeCount: 2 }));
ipcMain.handle('kb:clinical-list', (e, kind) => (kind === 'diag' ? DIAG : []));
ipcMain.handle('kb:clinical-rows', () => []);
ipcMain.handle('gbt:stats', () => gbt.stats());
ipcMain.handle('gbt:search', (e, { kind = 'all', q = '', l1 = '' } = {}) => gbt.search(q, kind, l1, 600));
ipcMain.handle('gbt:match-diag', () => {
  const m = gbt.matchNames(DIAG.map(d => d.name));
  return DIAG.map(d => ({ diag: d.name, ...m.get(d.name) })).filter(x => x.code);
});

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
    r.tabExists = !!document.querySelector('.tab[data-v="gbt"]');
    r.stG = document.getElementById('stG').textContent;
    // 进入国家标准页签
    switchView('gbt');
    await sleep(700);
    r.total = document.getElementById('gbtTotal').textContent;
    r.segNums = ['disease','syndrome','therapy'].map(k => document.getElementById('gbtN_'+k).textContent.trim());
    r.catsCount = document.querySelectorAll('#gbtCats button').length;
    r.itemCount = document.querySelectorAll('#gbtItems .it').length;
    r.firstRow = (document.querySelector('#gbtItems .it')||{}).textContent || '';
    // 切到证候
    gbtSeg('syndrome');
    await sleep(600);
    r.synCount = document.querySelectorAll('#gbtItems .it').length;
    r.synFirst = (document.querySelector('#gbtItems .gcode')||{}).textContent || '';
    // 检索
    document.getElementById('gbtSearch').value = '感冒';
    await gbtQuery();
    await sleep(200);
    // 切回病名检索「感冒」→ 应命中 A01.01.01
    gbtSeg('disease');
    await sleep(500);
    document.getElementById('gbtSearch').value = '感冒';
    await gbtQuery();
    await sleep(200);
    r.disHitCodes = Array.from(document.querySelectorAll('#gbtItems .gcode')).slice(0,3).map(x=>x.textContent);
    r.disHasGanMao011 = (document.getElementById('gbtItems').textContent||'').indexOf('A01.01.01') >= 0;
    // 大类筛选 A04（先清空检索词，否则是「A04 + 感冒」交集）
    document.getElementById('gbtSearch').value='';
    gbtL1Pick('A04');
    await sleep(500);
    r.catFilterFirst = (document.querySelector('#gbtItems .gcode')||{}).textContent || '';
    r.catFilterCount = document.querySelectorAll('#gbtItems .it').length;
    r.catFilterOn = (document.querySelector('#gbtCats button.on')||{}).textContent || '';
    // 再点一次取消筛选
    gbtL1Pick('A04');
    await sleep(400);
    r.catFilterCleared = !document.querySelector('#gbtCats button.on').textContent.startsWith('A04');
    r.stG = document.getElementById('stG').textContent;
    // 切辨证库验证徽标
    switchView('clinical');
    await sleep(400);
    r.clinBadge = (document.getElementById('clinItems').textContent||'').indexOf('A01.01.01') >= 0;
    r.clinRows = document.querySelectorAll('#clinItems .it').length;
    return r;
  })()`);
  console.log('PROBE_JSON=' + JSON.stringify(out, null, 1));
  app.exit(0);
});
