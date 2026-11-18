// scripts/_rec_aiocr.js - 框选 + AI 视觉识别演示动图（两段：遮罩选区点AI → HUD 进度）
// 用法：electron scripts/_rec_aiocr.js
const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { Recorder, openWin, sleep } = require('../lib/rec-core');

const ROOT = path.join(__dirname, '..');
const BG_FILE = 'C:/Users/Administrator/WorkBuddy/2026-09-09-10-13-42/tcm-competition/demo-shots/bg.png';
const OUT = path.join(ROOT, '.probe', 'gif');
const log = (m) => console.log('[rec] ' + m);

// 透明窗口 capturePage 空帧补丁：每帧前 invalidate 触发重绘
function patchCapture(win) {
  const cc = win.webContents;
  const orig = cc.capturePage.bind(cc);
  let n = 0;
  cc.capturePage = (...a) => {
    const p = orig(...a).then(im => { if (n < 3) console.log('[cap ok]', n, im && im.getSize().width); return im; },
                              e => { if (n < 5) console.log('[cap ERR]', n, e && e.message); throw e; });
    n++;
    return p;
  };
  return win;
}

ipcMain.handle('overlay:selected', async () => ({ ok: true }));
ipcMain.handle('overlay:cancel', async () => ({ ok: true }));
ipcMain.handle('sys:get', async () => ({}));

function bgDataUrl() {
  return 'data:image/png;base64,' + fs.readFileSync(BG_FILE).toString('base64');
}

// ---------- 段 A：框选处方笺 → 工具条点「AI」 ----------
async function sceneAiSel() {
  // 透明窗口 capturePage 在本机失败 → 改不透明窗 + HIS 底图注入 body 背景（成片视觉一致）
  const win = patchCapture(await openWin('overlay.html', 1280, 800, {}));
  const js = win.webContents.executeJavaScript.bind(win.webContents);
  win.webContents.send('overlay:bg', bgDataUrl());
  await js(`(function(){ const b='data:image/png;base64,' + ${JSON.stringify(fs.readFileSync(BG_FILE).toString('base64'))};
    const img = document.createElement('img'); img.id = 'recbg'; img.src = b;
    img.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;object-fit:cover;z-index:0;pointer-events:none';
    document.body.prepend(img); return 1; })()`);
  await js(`!document.body.classList.contains('pre')`).then(() => sleep(500));
  // 框住处方行（底图处方区，拉伸铺满口径）
  await js(`(() => { const el = document.elementFromPoint(120, 465); el.dispatchEvent(new MouseEvent('mousedown', {clientX:120, clientY:465, bubbles:true})); return 1; })()`);
  for (let i = 1; i <= 10; i++) {
    const x = 120 + Math.round((860 - 120) * i / 10), y = 465 + Math.round((605 - 465) * i / 10);
    await js(`(() => { document.elementFromPoint(${x}, ${y}).dispatchEvent(new MouseEvent('mousemove', {clientX:${x}, clientY:${y}, bubbles:true})); return 1; })()`);
    await sleep(60);
  }
  await js(`(() => { document.elementFromPoint(860, 605).dispatchEvent(new MouseEvent('mouseup', {clientX:860, clientY:605, bubbles:true})); return 1; })()`);
  await sleep(700);
  const r = new Recorder('18-AI视觉识别-选区', win, 10);
  await r.start();
  r.mark('① HIS 处方笺上一框选中：药味行 + 用法行');
  await r.wait(1600);
  r.mark('② 工具条点「AI」→ 云端视觉大模型转录，中药名与剂量更准');
  await r.spot('#bar .tb.ai', { after: 1700 });
  r.mark('③ 提交选区 → 自动截屏上传视觉模型');
  await r.click('#bar .tb.ai', { after: 800 });
  win.webContents.send('overlay:strip', true);
  await r.wait(1500);
  const meta = await r.stop();
  win.destroy();
  return meta;
}

// ---------- 段 B：AI 识别进度 HUD ----------
async function sceneAiHud() {
  const win = patchCapture(await openWin('hud.html', 380, 168, { x: 450, y: 320 }));
  const js = win.webContents.executeJavaScript.bind(win.webContents);
  await js(`(function(){ const b='data:image/png;base64,' + ${JSON.stringify(fs.readFileSync(BG_FILE).toString('base64'))};
    const img = document.createElement('img'); img.id = 'recbg'; img.src = b;
    img.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;object-fit:cover;z-index:0;pointer-events:none';
    document.body.prepend(img); return 1; })()`);
  await js(`window.__resetProg()`);
  await sleep(600);
  const r = new Recorder('18-AI视觉识别-进度', win, 10);
  await r.start();
  const steps = [
    [8,  'AI 视觉识别 · 连接视觉模型'],
    [26, 'AI 视觉识别 · 整图结构分析'],
    [48, 'AI 视觉识别 · 逐味转录药名与剂量'],
    [72, 'AI 视觉识别 · 校验用法与剂数'],
    [96, 'AI 视觉识别 · 完成'],
  ];
  for (const [pct, label] of steps) {
    await js(`window.__setProg(${pct}, ${JSON.stringify(label)})`);
    await r.wait(1500);
  }
  await js(`window.__setProg(100, 'AI 视觉识别 · 完成')`);
  r.mark('④ 进度 HUD 实时可见 · 全程 milestones 真实上报');
  await r.wait(1800);
  const meta = await r.stop();
  win.destroy();
  return meta;
}

// app.disableHardwareAcceleration();  // 本机开启反而导致 capturePage 崩溃（2026-10-22 实测）
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const only = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || '';
  const all = [['aiocr-sel', sceneAiSel], ['aiocr-hud', sceneAiHud]];
  for (const [n, fn] of (only ? all.filter(x => x[0] === only) : all)) {
    try {
      const m = await fn();
      if (m) {
        m.bg = '';   // 帧已含 HIS 底图，合成不再垫底
        const dir = path.join(OUT, m.name || n);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(m, null, 1));
        log('scene ' + n + ' -> frames=' + m.frames);
      }
    } catch (e) { log('scene ' + n + ' ERR ' + (e && e.stack || e)); }
  }
  await sleep(300);
  app.exit(0);
});
