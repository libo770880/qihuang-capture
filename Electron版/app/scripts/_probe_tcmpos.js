// 一次性取证：工具条「药」面板的四向择位 + 增高效果
// 场景：选区居中偏左（面板应贴右侧）／居中偏右（贴左侧）／顶部（放下方）／底部（放上方）／大选区几乎满屏
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
const OUT = path.join(__dirname, '..', '.probe', 'ui');
fs.mkdirSync(OUT, { recursive: true });

ipcMain.handle('overlay:selected', async () => ({ ok: true }));
ipcMain.handle('overlay:cancel', async () => ({ ok: true }));
ipcMain.handle('overlay:herb-info', async () => ({
  ok: true,
  herbs: ['黄芪', '党参', '白术', '茯苓', '陈皮', '半夏', '甘草', '当归', '川芎', '白芍'],
  cards: Array.from({ length: 10 }, (_, i) => ({
    n: ['黄芪', '党参', '白术', '茯苓', '陈皮', '半夏', '甘草', '当归', '川芎', '白芍'][i],
    cat: '补虚药', prop: '甘、苦，微温；归脾、肺经', fx: '补脾益气，燥湿利水，止汗，安胎',
    use: '6-12g，煎服；健脾止泻宜炒用', note: i === 5 ? '反乌头；孕妇慎用' : '阴虚燥渴者慎用',
    dose: (i + 3) + 'g', tox: i === 5 ? 1 : 0, pre: i === 5 ? 1 : 0,
  })),
  preds: [{ n: '四君子汤', origin: '《太平惠民和剂局方》', m: '脾胃气虚证', s: ['脾气虚'], comp: '人参9g、白术9g、茯苓9g、炙甘草6g', hit: ['党参', '白术', '茯苓', '甘草'], miss: [], inter: 4, compSize: 4, covF: 100, covRx: 100, classic: true }],
  usage: '每日1剂 水煎服 分早晚两次饭后内服', type: 'drugs', typeLabel: '药品', msg: 'Fixture',
}));
const BG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z8DAwMDAxAADjAwMAA8sAgWQ4W2nAAAAAElFTkSuQmCC';

const mouse = (win, type, x, y) => win.webContents.executeJavaScript(
  `document.dispatchEvent(new MouseEvent(${JSON.stringify(type)},{bubbles:true,cancelable:true,button:0,clientX:${x},clientY:${y}}));true`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const geom = (win) => win.webContents.executeJavaScript(`JSON.stringify((function(){
  const r=id=>{const b=document.getElementById(id).getBoundingClientRect();
    return {top:Math.round(b.top),left:Math.round(b.left),bottom:Math.round(b.bottom),right:Math.round(b.right),w:Math.round(b.width),h:Math.round(b.height)};};
  return {sel:r('sel'),bar:r('bar'),tcm:r('tcm'),vh:innerHeight,vw:innerWidth,
    disp:getComputedStyle(document.getElementById('tcm')).display,
    scrollH:document.getElementById('tcm').scrollHeight,
    cards:document.querySelectorAll('#tcmBody .hb').length};
})())`).then(JSON.parse);

async function reset(win) {
  await win.webContents.executeJavaScript(`document.querySelector('#bar .tb[data-k="redo"]').click();true`);
  await sleep(120);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440, height: 900, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
  await sleep(500);
  win.webContents.send('overlay:bg', BG);
  await sleep(300);

  const CASES = [
    { k: 'left',   name: '选区居中偏左', a: [80, 300], b: [520, 560] },
    { k: 'right',  name: '选区居中偏右', a: [900, 300], b: [1330, 560] },
    { k: 'top',    name: '选区贴近顶部', a: [200, 60], b: [760, 260] },
    { k: 'bottom', name: '选区贴近底部', a: [200, 640], b: [760, 850] },
    { k: 'wide',   name: '大选区（近满屏）', a: [90, 90], b: [1350, 800] },
  ];

  const rows = [];
  for (const c of CASES) {
    await reset(win);
    await mouse(win, 'mousedown', c.a[0], c.a[1]);
    await mouse(win, 'mousemove', c.b[0], c.b[1]);
    await mouse(win, 'mouseup', c.b[0], c.b[1]);
    await sleep(120);
    await win.webContents.executeJavaScript(
      `if(!bar.classList.contains('tcm-on'))document.querySelector('#bar .tb[data-k="tcm"]').click();true`);
    await sleep(600);
    const g = await geom(win);
    const overlapSel = !(g.tcm.left >= g.sel.right || g.tcm.right <= g.sel.left || g.tcm.top >= g.sel.bottom || g.tcm.bottom <= g.sel.top);
    const inView = g.tcm.left >= 0 && g.tcm.top >= 0 && g.tcm.right <= g.vw && g.tcm.bottom <= g.vh;
    const overlapBar = !(g.tcm.left >= g.bar.right || g.tcm.right <= g.bar.left || g.tcm.top >= g.bar.bottom || g.tcm.bottom <= g.bar.top);
    rows.push({ case: c.k, name: c.name, sel: g.sel, bar: g.bar, tcm: g.tcm, h: g.tcm.h, scrollH: g.scrollH, cards: g.cards, overlapSel, overlapBar, inView });
    try {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, 'tcmpos-' + c.k + '.png'), img.toPNG());
    } catch (e) { }
  }

  console.log(JSON.stringify(rows, null, 1));
  const bad = rows.filter(r => r.overlapSel || !r.inView || r.overlapBar || r.disp === 'none');
  console.log('\nBAD=' + bad.length);
  bad.forEach(r => console.log('  ' + r.case + ' overlapSel=' + r.overlapSel + ' overlapBar=' + r.overlapBar + ' inView=' + r.inView));
  app.quit();
});
