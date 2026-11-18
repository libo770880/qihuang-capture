const { app, ipcMain } = require('electron');
const path = require('path');
const { openWin, sleep } = require('../lib/rec-core');
const fs = require('fs');
const BG = 'C:/Users/Administrator/WorkBuddy/2026-09-09-10-13-42/tcm-competition/demo-shots/bg.png';
ipcMain.handle('overlay:selected', async () => ({ ok: true }));
ipcMain.handle('overlay:cancel', async () => ({ ok: true }));
app.whenReady().then(async () => {
  const win = await openWin('overlay.html', 1280, 800, {});
  win.webContents.send('overlay:bg', 'data:image/png;base64,' + fs.readFileSync(BG).toString('base64'));
  await sleep(800);
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    try {
      const img = await Promise.race([win.webContents.capturePage(), sleep(2500).then(() => null)]);
      console.log('[test] capture', i, img ? img.getSize().width + 'x' + img.getSize().height : 'NULL', (Date.now() - t0) + 'ms');
    } catch (e) { console.log('[test] capture ERR', i, e.message); }
    if (i === 2) {
      win.webContents.executeJavaScript(`document.dispatchEvent(new MouseEvent('mousedown',{clientX:120,clientY:465,bubbles:true,button:0})); 1`);
      await sleep(100);
      win.webContents.executeJavaScript(`document.dispatchEvent(new MouseEvent('mouseup',{clientX:860,clientY:605,bubbles:true,button:0})); 1`);
      await sleep(700);
    }
  }
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
