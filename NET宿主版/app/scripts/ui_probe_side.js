// 取证：侧栏收起/展开（把手 + Ctrl+B + 持久化）
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
app.disableHardwareAcceleration();
const OUT = path.join(__dirname, '..', '.probe', 'ui');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1100, height: 800, show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true } });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'panel.html'));
  await sleep(1500);
  const out = {};
  const js = async (code) => { try { return await win.webContents.executeJavaScript(code); } catch (e) { return 'ERR:' + String(e && e.message || e).slice(0, 120); } };
  out.hasHandle = await js(`try{localStorage.removeItem('qhjf.sideoff');}catch(e){} document.body.classList.remove('sideoff'); !!document.getElementById('sideHandle')`);
  await js(`document.getElementById('sideHandle').click()`);
  await sleep(400);
  out.offAfterClick = await js(`document.body.classList.contains('sideoff')`);
  out.sideGone = await js(`getComputedStyle(document.querySelector('.side')).display==='none'`);
  out.stored = await js(`localStorage.getItem('qhjf.sideoff')`);
  const img1 = await win.capturePage();
  fs.writeFileSync(path.join(OUT, 'side-collapsed.png'), img1.toPNG());
  await js(`document.getElementById('sideHandle').click()`);
  await sleep(400);
  out.onAfterClick2 = await js(`!document.body.classList.contains('sideoff') && getComputedStyle(document.querySelector('.side')).display!=='none'`);
  await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'b',ctrlKey:true,bubbles:true}))`);
  await sleep(300);
  out.offAfterCtrlB = await js(`document.body.classList.contains('sideoff')`);
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'panel.html'));
  await sleep(1200);
  out.keptAfterReload = await js(`document.body.classList.contains('sideoff')`);
  await js(`document.getElementById('sideHandle').click()`);
  console.log(JSON.stringify(out));
  const pass = out.hasHandle === true && out.offAfterClick === true && out.sideGone === true && out.stored === '1'
    && out.onAfterClick2 === true && out.offAfterCtrlB === true && out.keptAfterReload === true;
  console.log(pass ? 'side-collapse 7/7 ALL_OK' : 'side-collapse HAS_FAIL');
  app.exit(pass ? 0 : 1);
});
