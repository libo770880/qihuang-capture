// UI 探针：知识检索分类chips + 症状直达 + 中成药筛选
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const KB = require('../lib/kb');

ipcMain.handle('kb:list-all', () => ({
  herbs: KB.getAllHerbs(),
  formulas: KB.getAllFormulas()
}));
ipcMain.handle('app:version', () => 'x');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 860, show: false, webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true } });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'search.html'));
  await new Promise(r => setTimeout(r, 1200));
  const r = await win.webContents.executeJavaScript(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    await sleep(800);
    const out = {};
    out.sxChips = document.querySelectorAll('#kbsSx .c').length;
    out.catChips = document.querySelectorAll('#kbsCat .c').length; // all 页签为提示文案
    // 切到中药页签 → 分类 chips
    const tabs = document.querySelectorAll('.kbs .fs button');
    tabs[2].click(); // 中药
    await sleep(300);
    out.herbCatN = document.querySelectorAll('#kbsCat .c').length;
    out.herbCatOn = (document.querySelector('#kbsCat .c.on') || {}).textContent || '';
    // 点「清热药」分类
    const hot = [...document.querySelectorAll('#kbsCat .c')].find(c => /清热药/.test(c.textContent));
    if (hot) { hot.click(); await sleep(300); }
    out.afterCatCount = (document.querySelector('.kbs .cnt') || {}).textContent || '';
    out.firstCat = (document.querySelector('#kbsCat .c.on') || {}).textContent || '';
    // 症状直达：点「咳嗽」
    const sx = [...document.querySelectorAll('#kbsSx .c')].find(c => c.dataset.sx === '咳嗽');
    if (sx) { sx.click(); await sleep(300); }
    out.qVal = (document.querySelector('.kbs .inp') || {}).value || '';
    out.sxResult = (document.querySelector('.kbs .cnt') || {}).textContent || '';
    // 切到方剂页签 → 汤方/中成药
    tabs[1].click();
    await sleep(300);
    out.fChips = [...document.querySelectorAll('#kbsCat .c')].map(c => c.textContent).join('|');
    const pat = [...document.querySelectorAll('#kbsCat .c')].find(c => /中成药/.test(c.textContent));
    if (pat) { pat.click(); await sleep(300); }
    out.patentCount = (document.querySelector('.kbs .cnt') || {}).textContent || '';
    out.patentBadge = document.querySelector('.kbs .li .pk.p') ? true : false;
    return out;
  })()`);
  console.log('PROBE_JSON=' + JSON.stringify(r, null, 1));
  app.exit(0);
}).catch(e => { console.error('PROBE_ERR', e); app.exit(1); });
