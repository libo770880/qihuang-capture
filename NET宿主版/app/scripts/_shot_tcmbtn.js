// 一次性取证：①「药」详情面板与选区/工具条的几何关系（不盖选区） ②panel .ghost/.primary 新样式
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
const OUT = path.join(__dirname, '..', '.probe', 'ui');
fs.mkdirSync(OUT, { recursive: true });

ipcMain.handle('overlay:selected', async () => ({ ok: true }));
ipcMain.handle('overlay:cancel', () => ({ ok: true }));
ipcMain.handle('overlay:herb-info', async () => ({
  ok: true,
  herbs: ['大黄', '黄芪', '党参', '白术', '茯苓', '陈皮', '半夏', '甘草'],
  cards: Array.from({ length: 8 }, (_, i) => ({
    n: '药' + i, cat: '补虚药', prop: '甘温', fx: '补气', use: '9-30g', note: '湿盛者慎', dose: '9g', tox: 0, pre: 0,
  })),
  preds: [{ n: '四君子汤', origin: '《局方》', m: '脾胃气虚证', s: ['脾气虚'], comp: '人参9g', hit: ['白术'], miss: [], inter: 1, compSize: 4, covF: 25, covRx: 25, classic: true }],
  usage: '每日1剂 水煎服', type: 'drugs', typeLabel: '药品', msg: 'Fixture',
}));
const BG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z8DAwMDAxAADjAwMAA8sAgWQ4W2nAAAAAElFTkSuQmCC';

function mouse(win, type, x, y) {
  return win.webContents.executeJavaScript(
    `document.dispatchEvent(new MouseEvent(${JSON.stringify(type)},{bubbles:true,cancelable:true,button:0,clientX:${x},clientY:${y}}));true`);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function geom(win) {
  return JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((function(){
    const r=id=>{const b=document.getElementById(id).getBoundingClientRect();
      return {top:Math.round(b.top),bottom:Math.round(b.bottom),left:Math.round(b.left),h:Math.round(b.height)};};
    return {sel:r('sel'),bar:r('bar'),tcm:r('tcm'),
      tcmDisp:getComputedStyle(document.getElementById('tcm')).display,
      vh:innerHeight};
  })())`));
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1200, height: 800, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true } });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
  await sleep(500);
  win.webContents.send('overlay:bg', BG);
  await sleep(300);
  const res = {};

  // 用例A：选区在屏幕上部 → 面板必须在工具条之下、选区之下，不与选区相交
  await mouse(win, 'mousedown', 100, 80); await mouse(win, 'mousemove', 300, 150); await mouse(win, 'mouseup', 300, 150);
  await sleep(150);
  await win.webContents.executeJavaScript(`document.querySelector('#bar .tb[data-k="tcm"]').click();true`);
  await sleep(700);
  let g = await geom(win);
  res.A_toolbar_below = g.bar.top >= g.sel.bottom;
  res.A_panel_below_bar = g.tcmDisp === 'block' && g.tcm.top >= g.bar.bottom - 2;
  res.A_no_overlap_sel = g.tcm.top >= g.sel.bottom || g.tcm.bottom <= g.sel.top;
  try { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(OUT, 'overlay-tcm-below.png'), img.toPNG()); } catch (e) { res.shotA = 'skip:' + e.message.slice(0, 30); }

  // 用例B：选区贴近屏幕底部 → 下方放不下，面板移到选区上方，仍不盖选区
  //（resetSelect 后 tcm-on 仍在、松手会自动重跑，仅当面板关着才点开）
  await win.webContents.executeJavaScript(`document.querySelector('#bar .tb[data-k="redo"]').click();true`);
  await sleep(150);
  await mouse(win, 'mousedown', 100, 560); await mouse(win, 'mousemove', 300, 620); await mouse(win, 'mouseup', 300, 620);
  await sleep(700);
  await win.webContents.executeJavaScript(
    `if(!document.getElementById('bar').classList.contains('tcm-on')) document.querySelector('#bar .tb[data-k="tcm"]').click();true`);
  await sleep(700);
  g = await geom(win);
  res.B_no_overlap_sel = g.tcm.top >= g.sel.bottom || g.tcm.bottom <= g.sel.top;
  res.B_panel_visible = g.tcmDisp === 'block' && g.tcm.h > 100;
  try { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(OUT, 'overlay-tcm-flip.png'), img.toPNG()); } catch (e) { res.shotB = 'skip:' + e.message.slice(0, 30); }

  // 用例C：panel.html 的 .ghost / .ghost.primary 样式生效
  const win2 = new BrowserWindow({ width: 1100, height: 800, show: false,
    webPreferences: { preload: path.join(__dirname, '_shot_preload.js'), contextIsolation: false, sandbox: false } });
  await win2.loadFile(path.join(__dirname, '..', 'renderer', 'panel.html'));
  await sleep(1800);
  const btn = JSON.parse(await win2.webContents.executeJavaScript(`JSON.stringify((function(){
    document.body.insertAdjacentHTML('beforeend',
      '<div id="btntest" style="position:fixed;left:-9999px"><button class="ghost" id="b1">取消</button>'+
      '<button class="ghost primary" id="b2">保存并重新审方</button></div>');
    const cs=id=>{const s=getComputedStyle(document.getElementById(id));
      return {bg:s.backgroundColor,bd:s.borderColor,radius:s.borderRadius,pad:s.padding,color:s.color,fs:s.fontSize};};
    return {ghost:cs('b1'),primary:cs('b2')};
  })())`));
  res.C_ghost_styled = parseInt(btn.ghost.radius) > 0 && btn.ghost.pad !== '0px' && btn.ghost.bd !== 'rgb(118, 118, 118)';
  res.C_primary_green = /rgb\(29, 111, 75\)/.test(btn.primary.bg); // var(--green)=#1d6f4b
  try { const img = await win2.webContents.capturePage(); } catch (e) {}

  console.log(JSON.stringify(res, null, 1));
  const okAll = Object.entries(res).every(([k, v]) => k.startsWith('shot') || v === true);
  console.log(okAll ? 'GEOM/BTN ALL_OK' : 'HAS_FAIL');
  app.quit();
});
