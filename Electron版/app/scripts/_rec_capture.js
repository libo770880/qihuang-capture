// scripts/_rec_capture.js - 多种采集方式演示动图（独立宿主，fixture IPC + 伪摄像头）
// 三段：①面板采集入口 ②粘贴采集（粘贴框真实界面+真实进度条） ③拍照识别（伪摄像头取景→拍照→识别）
// 用法：electron scripts/_rec_capture.js [--only=cap-panel,cap-paste,cap-photo]
const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { Recorder, openWin, sleep, OUT } = require('../lib/rec-core');

const ROOT = path.join(__dirname, '..');
const BG_FILE = 'C:/Users/Administrator/WorkBuddy/2026-09-09-10-13-42/tcm-competition/demo-shots/bg.png';
const PAPER_FILE = path.join(ROOT, '.probe', 'paper-rx.png');   // 纸质处方笺样张（拍照段底图）
const only = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || '';
const log = (m) => console.log('[rec] ' + m);

// ---------- 演示文本（HIS 复制出来的病历+处方） ----------
const DEMO_TEXT = [
  '门诊病历',
  '科别：骨伤科　就诊日期：2026-10-20',
  '患者姓名：周某某　性别：女　年龄：47岁',
  '中医诊断：腰痹病（气滞血瘀证）',
  '主诉：腰痛反复发作2年，加重3天。',
  '查体：腰4/5棘旁压痛(+)，直腿抬高试验(-)。',
  'Rp：',
  '杜仲 12g　桑寄生 15g　川断 12g',
  '牛膝 9g　独活 9g　当归 12g',
  '延胡索 9g　狗脊 12g　伸筋草 15g',
  '甘草 6g',
  '医嘱：水煎400ml，日一剂，早晚温服 × 7剂',
].join('\n');
// 手工标注的 HIS 结构行（真实系统按噪声规则判定；录制用等价结果）
const NOISE_HEADS = ['门诊病历', '科别：', '患者姓名：', 'Rp：'];

// ---------- fixture IPC ----------
ipcMain.handle('ball:open-paste', async () => ({ ok: true }));
ipcMain.handle('panel:start-region', async () => ({ ok: true }));
ipcMain.handle('photo:open', async () => ({ ok: true }));
ipcMain.handle('clipboard:read', async () => DEMO_TEXT);
ipcMain.handle('panel:list', async () => (demoRec ? [demoRec] : []));
ipcMain.handle('panel:get', async (e, id) => (demoRec && id === demoRec.id ? demoRec : null));
ipcMain.handle('sys:get', async () => ({}));
ipcMain.handle('ui:prefs-get', async () => ({}));
ipcMain.handle('ai:config-get', async () => ({ hasKey: true, modelLabel: 'DeepSeek · deepseek-chat' }));
ipcMain.handle('rxrule:get', async () => ({}));
ipcMain.handle('rx:rules', async () => ({}));
ipcMain.handle('paste:segment', async (e, text) => {
  const lines = String(text || '').replace(/[ \t]+/g, ' ').split('\n').map(s => s.trim()).filter(Boolean);
  const rows = lines.map(s => ({ text: s, tag: NOISE_HEADS.some(h => s.startsWith(h)) }));
  const kept = rows.filter(r => !r.tag).length;
  return { rows, kept, removed: rows.length - kept };
});
let pasteResolve = null;
ipcMain.handle('paste:submit', async () => {
  // 模拟识别管线耗时：期间宿主持续发送真实进度事件，粘贴框进度条真实滚动
  const win = app.__capPasteWin;
  const steps = [[8, '正在解析行结构…'], [30, '清洗 HIS 界面标签…'], [58, '纠正药名与剂量…'], [86, '构建记录并触发本地分析…']];
  for (const [pct, label] of steps) {
    if (win && !win.isDestroyed()) win.webContents.send('paste:progress', { pct, label });
    await sleep(1100);
  }
  return { ok: true };
});
let photoBusyUntil = 0;
// 拍照识别闭环演示：识别完成后往面板注入一条「拍照来源」记录（跳转面板段用）
let demoRec = null;
ipcMain.handle('photo:submit', async () => {
  photoBusyUntil = Date.now() + 3200;
  await sleep(3200);
  demoRec = {
    id: 'recdemo-photo-' + Date.now().toString(36),
    ts: new Date().toISOString(),
    source: 'photo', winTitle: '',
    patient: '周某某', dept: '骨伤科',
    diag: '腰痹病', synd: '气滞血瘀证',
    text: DEMO_TEXT,
  };
  return { ok: true };
});

// ---------- 段1：面板采集入口（spot 标注，不真点） ----------
async function sceneCapPanel() {
  const win = await openWin('panel.html', 1100, 720);
  const r = new Recorder('09a-采集入口总览', win, 10);
  const js = r.js;
  await js(`(async () => { cur = null; await refresh(); return 1; })()`);
  await sleep(800);
  await r.start();
  r.mark('① 方式一 · 粘贴采集：HIS 里 Ctrl+C → Ctrl+Alt+V');
  await r.spot('.capb.main', { after: 1600 });
  r.mark('② 方式二 · 框选抓取：屏幕上直接拖框识别');
  await r.spot('.capb:nth-child(2)', { after: 1600 });
  r.mark('③ 方式三 · 拍照识别：纸质处方 / 手机照片');
  await r.spot('.capb:nth-child(3)', { after: 1600 });
  r.mark('④ 多种入口 · 同一识别管线 · 同一知识库');
  await r.wait(2200);
  const meta = await r.stop();
  win.destroy();
  return meta;
}

// ---------- 段2：粘贴采集（粘贴框） ----------
async function sceneCapPaste() {
  const win = await openWin('pastebox.html', 580, 600);
  app.__capPasteWin = win;
  const r = new Recorder('09b-粘贴采集', win, 10);
  const js = r.js;
  await sleep(900);
  await r.start();
  r.mark('① Ctrl+Alt+V 唤起粘贴框：文本原样入库，零识别误差');
  await r.wait(1300);
  r.mark('② 点「读剪贴板」（等价手动 Ctrl+V）');
  await r.click('#btnClip', { after: 1300 });
  r.mark('③ 自动划行：灰底删除线 = HIS 界面标签行，入库自动剔除');
  await r.wait(2000);
  r.mark('④ 点「入库分析」→ 识别管线自动运行');
  await r.click('#btnGo', { after: 1200 });
  r.mark('⑤ 全程离线：清洗 → 纠错 → 分段 → 入库');
  await r.wait(3000);
  r.mark('⑥ 入库完成 ✓ 本地分析自动运行');
  await r.wait(2200);
  const meta = await r.stop();
  win.destroy();
  app.__capPasteWin = null;
  return meta;
}

// ---------- 段3：拍照识别（canvas 伪摄像头） ----------
// Chromium 的 fake-file-camera 在本机不生效，改注入 canvas 流：页面真实链路
// （getUserMedia → video → 拍照冻结 → 识别）完全不变，只是"摄像头"内容由画布提供。
const CAM_JS = `(async () => {
  const video = document.getElementById('video');
  const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 800;
  const ctx = cv.getContext('2d');
  const img = new Image();
  img.src = __CAM_BG;
  await new Promise(r => { img.onload = r; img.onerror = r; });
  let t0 = performance.now();
  (function loop() {
    const t = (performance.now() - t0) / 1000;
    if (img.width) {
      // 竖版处方笺按高度适配完整入画，外加手持感：轻微缩放漂移
      const base = Math.min(cv.width * 0.60 / img.width, cv.height * 0.95 / img.height);
      const z = base * (1.012 + 0.010 * Math.sin(t / 1.3));
      const w = img.width * z, h = img.height * z;
      const x = (cv.width - w) / 2 + 12 * Math.sin(t / 0.9);
      const y = (cv.height - h) / 2 + 8 * Math.cos(t / 1.15);
      ctx.fillStyle = '#20241f'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, x, y, w, h);
    }
    if (video.srcObject && video.srcObject.getVideoTracks) requestAnimationFrame(loop);
  })();
  video.srcObject = cv.captureStream(15);
  return 1;
})()`;

async function sceneCapPhoto() {
  // 900×680：与结尾跳转的记录面板同 CSS 尺寸（swap 换窗续录要求两窗一致）
  const win = await openWin('photo.html', 900, 680);
  const r = new Recorder('09c-拍照识别', win, 10);
  const js = r.js;
  const b64 = fs.readFileSync(PAPER_FILE).toString('base64');
  await js(`window.__CAM_BG = 'data:image/png;base64,` + b64 + `'; 1`);
  await js(CAM_JS);
  await r.until(`document.getElementById('video') && document.getElementById('video').videoWidth > 0`, 12000);
  await sleep(700);
  await r.start();
  r.mark('① 摄像头取景：对准纸质处方（手机横拍）');
  await r.wait(1600);
  r.mark('② 点「拍照」冻结画面');
  await r.click('#btnShot', { after: 1200 });
  r.mark('③ 确认清晰后点「识别此图」');
  await r.click('#btnOcr', { after: 1200 });
  r.mark('④ 高精度 OCR 识别中…（完成后自动入库）');
  await r.wait(2600);

  // B 段：换窗到记录面板（同尺寸，帧无缝衔接）——识别完成 → 分析进度条 → 面板呈现
  // 记录由 photo:submit fixture 在识别完成时注入；轮询期间反复 refresh，防止注入晚于首刷
  const pwin = await openWin('panel.html', 900, 680);
  await pwin.webContents.executeJavaScript(`(async () => { cur = null; await refresh(); return 1; })()`);
  const found = await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      try {
        if (await pwin.webContents.executeJavaScript(`(async () => { await refresh(); return document.querySelectorAll('#list .rec').length > 0; })()`)) return true;
      } catch (e) { /* ignore */ }
      await sleep(150);
    }
    return false;
  })();
  log('panel record visible = ' + found);
  await sleep(300);
  r.swap(pwin);
  win.destroy();

  r.mark('⑤ 识别完成 · 自动入库并跳转记录面板');
  const prog = (pct, label) => pwin.webContents.send('cap:progress', { pct, label });
  const forceShow = () => pwin.webContents.executeJavaScript(
    `(function(){ const el=document.getElementById('capProg'); if(el) el.style.display='flex'; return 1; })()`);
  prog(10, '正在读取照片文本…'); await forceShow();
  await r.wait(700);
  prog(45, 'OCR 高精度识别处方…'); await r.wait(800);
  prog(78, '清洗 HIS 标签 · 纠正药名剂量…'); await r.wait(800);
  prog(100, '入库完成');
  await pwin.webContents.executeJavaScript(`(function(){ if (typeof hideCapProgress==='function') hideCapProgress(); return 1; })()`);
  await r.wait(500);

  r.mark('⑥ 记录面板：来源「拍照」 · 科室 / 诊断自动归位');
  await r.click('#list .rec', { after: 1200 });
  r.mark('⑦ 原文可复核 · 同一知识库 · 同一审方引擎');
  await r.wait(2000);
  const meta = await r.stop();
  if (!win.isDestroyed()) win.destroy();
  pwin.destroy();
  return meta;
}

// ---------- 段4：窗口采集（悬浮球 → 整窗识别，四通道闭环） ----------
// A 段拍仿真 HIS 窗口（真实 OS 窗口，画面即所抓）；B 段 swap 到记录面板（同尺寸无缝衔接）
const HIS_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box;font-family:"Microsoft YaHei",sans-serif}
  body{width:900px;height:680px;background:#eef1f5;display:flex;flex-direction:column}
  .tb{height:34px;background:#1f4e79;color:#fff;display:flex;align-items:center;padding:0 12px;font-size:13px}
  .tb b{font-size:14px}.tb .x{margin-left:auto;opacity:.8}
  .menu{height:26px;background:#f6f8fa;border-bottom:1px solid #d5dbe2;font-size:12px;color:#333;
        display:flex;gap:18px;align-items:center;padding:0 12px}
  .main{flex:1;display:flex;min-height:0}
  .side{width:150px;background:#fff;border-right:1px solid #d5dbe2;font-size:12px;color:#444;padding:8px 0}
  .side div{padding:6px 14px}.side div.on{background:#e8f0fb;color:#1f4e79;font-weight:600}
  .ct{flex:1;background:#fff;margin:10px;border:1px solid #d5dbe2;padding:14px 18px;font-size:14px;color:#222;line-height:1.9;overflow:hidden}
  .ct h3{font-size:15px;color:#1f4e79;margin-bottom:6px}
  .ct .lab{color:#6b7684;font-size:12px;margin-right:8px}
  .rx{margin-top:10px;border-top:1px dashed #c9d2dc;padding-top:8px}
  .rx b{color:#8a4b0f}
  .sb{height:24px;background:#f6f8fa;border-top:1px solid #d5dbe2;font-size:11px;color:#7a8593;display:flex;align-items:center;padding:0 12px}
</style></head><body>
  <div class="tb"><b>住院医生工作站 V6.2</b><span style="margin-left:14px;font-size:12px">骨伤科病区</span><span class="x">— □ ✕</span></div>
  <div class="menu"><span>首页</span><span>病人列表</span><span style="color:#1f4e79;font-weight:600">病历文书</span><span>医嘱处理</span><span>检查检验</span></div>
  <div class="main">
    <div class="side"><div class="on">周某某 女 47岁</div><div>李某 男 63岁</div><div>吴某 女 35岁</div><div>赵某 男 58岁</div></div>
    <div class="ct">
      <h3>门诊病历</h3>
      <div><span class="lab">科别</span>骨伤科　<span class="lab">就诊日期</span>2026-10-20</div>
      <div><span class="lab">患者</span>周某某　女　47岁</div>
      <div><span class="lab">中医诊断</span>腰痹病（气滞血瘀证）</div>
      <div><span class="lab">主诉</span>腰痛反复发作2年，加重3天。</div>
      <div><span class="lab">查体</span>腰4/5棘旁压痛(+)，直腿抬高试验(-)。</div>
      <div class="rx"><b>Rp：</b><br>
        杜仲 12g　桑寄生 15g　川断 12g<br>
        牛膝 9g　独活 9g　当归 12g<br>
        延胡索 9g　狗脊 12g　伸筋草 15g<br>
        甘草 6g</div>
      <div style="margin-top:8px"><span class="lab">医嘱</span>水煎400ml，日一剂，早晚温服 × 7剂</div>
    </div>
  </div>
  <div class="sb">就绪　|　HIS-PC-031　|　2026-10-22 14:30</div>
</body></html>`;

async function sceneCapWindow() {
  const { BrowserWindow } = require('electron');
  const { pathToFileURL } = require('url');
  const tmp = path.join(ROOT, '.probe', 'his-mock.html');
  fs.writeFileSync(tmp, HIS_HTML);
  const his = new BrowserWindow({ width: 900, height: 680, show: false, frame: false,
    webPreferences: { paintWhenInitiallyHidden: true, backgroundThrottling: false } });
  his.setContentSize(900, 680);
  await his.loadURL(pathToFileURL(tmp).href);
  his.show();
  await sleep(900);
  const r = new Recorder('09d-窗口采集', his, 10);
  await r.start();
  r.mark('① 方式四 · 窗口采集：悬浮球菜单 → 「抓取当前窗口」');
  await r.wait(1800);
  r.mark('② 不拖框不截图排版：整窗画面一次抓全');
  await r.wait(1600);
  r.mark('③ 识别管线运行：读取 → OCR → 纠错 → 审方');
  demoRec = {
    id: 'recdemo-win-' + Date.now().toString(36),
    ts: new Date().toISOString(),
    source: 'window', winTitle: '住院医生工作站 V6.2',
    patient: '周某某', dept: '骨伤科',
    diag: '腰痹病', synd: '气滞血瘀证',
    text: DEMO_TEXT,
  };
  const pwin = await openWin('panel.html', 900, 680);
  await pwin.webContents.executeJavaScript(`(async () => { cur = null; await refresh(); return 1; })()`);
  const found = await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      try {
        if (await pwin.webContents.executeJavaScript(`(async () => { await refresh(); return document.querySelectorAll('#list .rec').length > 0; })()`)) return true;
      } catch (e) {}
      await sleep(150);
    }
    return false;
  })();
  log('panel record visible = ' + found);
  await sleep(300);
  r.swap(pwin);
  his.destroy();
  r.mark('④ 入库完成 · 自动跳转记录面板（来源「窗口」）');
  const prog = (pct, label) => pwin.webContents.send('cap:progress', { pct, label });
  const forceShow = () => pwin.webContents.executeJavaScript(
    `(function(){ const el=document.getElementById('capProg'); if(el) el.style.display='flex'; return 1; })()`);
  prog(10, '正在读取整窗画面…'); await forceShow();
  await r.wait(700);
  prog(45, 'OCR 整窗识别中…'); await r.wait(800);
  prog(78, '清洗界面标签 · 纠正药名剂量…'); await r.wait(800);
  prog(100, '入库完成');
  await pwin.webContents.executeJavaScript(`(function(){ if (typeof hideCapProgress==='function') hideCapProgress(); return 1; })()`);
  await r.wait(500);
  r.mark('⑤ 现场本地分析：辨证 · 方剂反查 · 审方');
  await r.click('#list .rec', { after: 1400 });
  r.mark('⑥ 四条采集通道 · 同一知识库 · 同一审方引擎');
  await r.wait(2000);
  const meta = await r.stop();
  pwin.destroy();
  return meta;
}

const SCENES = { 'cap-panel': sceneCapPanel, 'cap-paste': sceneCapPaste, 'cap-photo': sceneCapPhoto, 'cap-window': sceneCapWindow };

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const names = (only || Object.keys(SCENES).join(',')).split(',').filter(Boolean);
  for (const n of names) {
    try {
      const m = await SCENES[n]();
      if (m) {
        const dir = path.join(OUT, m.name || n);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(m, null, 1));
        console.log('[rec] scene ' + n + ' -> frames=' + m.frames);
      }
    } catch (e) { console.log('[rec] scene ' + n + ' ERR ' + (e && e.stack || e)); }
  }
  await sleep(300);
  app.exit(0);
});
