// 演示页截图：依次切换三个页签，导出 PNG 供版式核对
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: { offscreen: false },
  });
  await win.loadFile(path.join(__dirname, '..', 'demo-his.html'));
  await new Promise(r => setTimeout(r, 900));
  const dir = path.join(__dirname, '..', '.probe', 'his');
  fs.mkdirSync(dir, { recursive: true });
  for (const t of ['out', 'in', 'rx']) {
    await win.webContents.executeJavaScript(
      `document.querySelector('[data-tab="${t}"]').click(); document.body.dataset.tab='${t}'; true`
    );
    await new Promise(r => setTimeout(r, 400));
    const img = await win.webContents.capturePage();
    const f = path.join(dir, t + '.png');
    fs.writeFileSync(f, img.toPNG());
    console.log('[shot]', f, img.getSize().width + 'x' + img.getSize().height);
  }
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
