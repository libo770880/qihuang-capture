// UI 探针：「备份」页签的国标参照库状态区（#refList / refSyncNow）渲染验证
// 用法: electron scripts/ui_probe_ref.js --data=<用户数据目录>
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const argData = (process.argv.find(a => a.startsWith('--data=')) || '').slice(7);
const DB = require('../lib/db');
DB.initDb(argData, () => {});
try { require('../lib/refsync').syncAll(); } catch (e) { console.error('syncAll:', e.message); }

const ROOT = path.join(__dirname, '..');
ipcMain.handle('kb:stats', () => ({ formulaBuiltin: 322, herbBuiltin: 385, formulaUser: 0, herbUser: 0 }));
ipcMain.handle('kb:list-all', () => ({ herbs: [], formulas: [] }));
ipcMain.handle('kb:yibao-list', () => []);
ipcMain.handle('sys:get', () => ({}));
ipcMain.handle('gbt:stats', () => ({ total: 0, disease: { count: 0, cats: [] }, syndrome: { count: 0, cats: [] }, therapy: { count: 0, cats: [] } }));
ipcMain.handle('gbt:search', () => ({ list: [], truncated: false }));
ipcMain.handle('gbt:match-diag', () => []);
ipcMain.handle('icd:stats', () => ({ total: 0, diffCode: 0, diffName: 0, diffCats: {} }));
ipcMain.handle('icd:search', () => ({ list: [], truncated: false }));
ipcMain.handle('ref:info', () => ({ ok: true, list: DB.refInfo(), gbtSource: 'db', icdSource: 'db' }));
ipcMain.handle('ref:sync', () => ({ ok: true, out: require('../lib/refsync').syncAll(), info: DB.refInfo() }));
ipcMain.handle('data:info', () => ({ ok: true, dir: argData, portable: false }));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1480, height: 920, show: false,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true }
  });
  await win.loadFile(path.join(ROOT, 'renderer/admin.html'));
  const out = await win.webContents.executeJavaScript(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    await sleep(400);
    const r = {};
    r.tabExists = !!document.querySelector('.tab[data-v="backup"]');
    switchView('backup');
    await refLoadInfo();
    await sleep(300);
    const box = document.getElementById('refList');
    r.text = (box.textContent || '').replace(/\\s+/g, ' ').trim();
    r.okBadges = (box.textContent.match(/✓ 已入库/g) || []).length;
    r.blocks = box.querySelectorAll('div').length;
    r.hasFingerprint = box.textContent.indexOf('指纹') >= 0;
    // 手动重同步
    await refSyncNow();
    await sleep(300);
    r.syncMsg = document.getElementById('bkSt3').textContent;
    // 数据目录区块
    r.dataDir = document.getElementById('bkDataDir').textContent;
    return r;
  })()`);
  console.log('PROBE_JSON=' + JSON.stringify(out, null, 1));
  app.exit(0);
});
