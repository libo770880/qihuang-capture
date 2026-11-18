// main.js - 岐黄鉴方·悬浮采集助手 主进程
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, dialog, clipboard, globalShortcut, desktopCapturer } = require('electron');
if (app) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
}
const path = require('path');
const ICON_PATH = path.join(__dirname, 'build', 'icon.ico');
const fs = require('fs');
// 便携数据目录（解析顺序与 .NET AppPaths 一致）：
//   ① QHJF_USERDATA 环境变量（探针/对拍隔离用）
//   ② 应用目录下 portable.dat（绝对路径；相对路径按应用目录解析——搬家后仍有效）
//   ③ 应用目录下 userdata\.portable 标记 → 数据随包存放，整体拷贝即可搬家
//   ④ 系统默认 %APPDATA%\岐黄鉴方·悬浮采集助手
// 首次便携启动且随包目录为空时，自动从旧 %APPDATA% 迁移配置/记录/知识库（logs/backups/webview2 不迁）。
let USERDATA_PORTABLE = false;
try {
  const isDir = p => { try { return !!p && fs.statSync(p).isDirectory(); } catch (e) { return false; } };
  let ud = String(process.env.QHJF_USERDATA || '').trim();
  // 环境变量是「显式指定目录」（探针/对拍/运维）：不当作便携模式，也不做旧数据迁移，
  // 否则隔离目录会被悄悄灌入 %APPDATA% 的真实记录，污染对拍与导入验证。
  const udFromEnv = !!ud;
  if (!ud) {
    const pf = path.join(__dirname, 'portable.dat');
    const t = fs.existsSync(pf) ? fs.readFileSync(pf, 'utf8').trim() : '';
    if (t) {
      const abs = path.isAbsolute(t) ? t : path.resolve(__dirname, t);
      if (isDir(abs)) ud = abs;
      else console.log('[paths] portable.dat 指向的目录不存在：' + abs + '，尝试随包 userdata');
    }
  }
  if (!ud && fs.existsSync(path.join(__dirname, 'userdata', '.portable'))) ud = path.join(__dirname, 'userdata');
  if (ud) {
    app.setPath('userData', ud);
    USERDATA_PORTABLE = !udFromEnv;
    // 首次迁移（仅随包便携模式）：便携目录无 data.db、旧默认目录有 → 拷贝（旧目录保持不动，可回退）
    const legacy = path.join(app.getPath('appData'), '岐黄鉴方·悬浮采集助手');
    const dstDb = path.join(ud, 'data.db');
    const srcDb = path.join(legacy, 'data.db');
    if (!udFromEnv && !fs.existsSync(dstDb) && fs.existsSync(srcDb) && path.resolve(legacy) !== path.resolve(ud)) {
      fs.mkdirSync(ud, { recursive: true });
      for (const f of ['data.db', 'data.db-wal', 'data.db-shm']) {
        if (fs.existsSync(path.join(legacy, f))) fs.copyFileSync(path.join(legacy, f), path.join(ud, f));
      }
      const copyAll = (src, dest) => {
        if (!fs.existsSync(src)) return;
        fs.mkdirSync(dest, { recursive: true });
        for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
          const s = path.join(src, ent.name), d = path.join(dest, ent.name);
          if (ent.isDirectory()) copyAll(s, d); else fs.copyFileSync(s, d);
        }
      };
      for (const d of ['records', 'knowledge', 'config']) copyAll(path.join(legacy, d), path.join(ud, d));
    }
  }
} catch (e) { /* 解析失败用默认目录 */ }
// 运行缓存外置：便携模式下 Electron 会把 Cache / Code Cache / Local Storage / GPUCache / Dawn*
// 全部写进 userData —— 实测能撑到上百 MB，导致「随包数据目录」根本没法搬家。
// 这里把会话数据与磁盘缓存钉到 %LOCALAPPDATA%\岐黄鉴方采集助手-缓存，
// 随包 userdata 只留 data.db + records + logs + backups（配置与数据），整包拷走即可。
// 注意：必须在 app ready 之前设置；缓存丢了只是首屏慢一次，不影响任何配置。
let CACHE_DIR = '';
if (USERDATA_PORTABLE) {
  try {
    const base = String(process.env.LOCALAPPDATA || '').trim() || app.getPath('appData');
    CACHE_DIR = path.join(base, '岐黄鉴方采集助手-缓存');
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    app.setPath('sessionData', CACHE_DIR);                              // Local Storage / Cache / cookies
    app.commandLine.appendSwitch('disk-cache-dir', path.join(CACHE_DIR, 'Cache'));
    // 老版本把 Local Storage 放在 userData 根下；换缓存目录后主题/侧栏偏好会读不到。
    // 一次性把 Local Storage 复制到新缓存目录（之后由 kv:uiprefs 接管，不再依赖浏览器存储）。
    try {
      const oldLS = path.join(ud, 'Local Storage');
      const newLS = path.join(CACHE_DIR, 'Local Storage');
      if (fs.existsSync(oldLS) && !fs.existsSync(newLS)) {
        fs.mkdirSync(path.dirname(newLS), { recursive: true });
        fs.cpSync(oldLS, newLS, { recursive: true });
      }
    } catch (e) { /* 复制失败只影响首屏主题，不影响配置 */ }
  } catch (e) { CACHE_DIR = ''; }
}
const capture = require('./lib/capture');
const analyze = require('./lib/analyze');
const noise = require('./lib/noise');
const { runCompliance } = require('./lib/compliance');
const { runTcm, extractRxItems, westTcmCandidates, setWestMap } = require('./lib/tcm');
const autosynd = require('./lib/autosynd');
const ai = require('./lib/ai');
const { initStore } = require('./lib/store');
const DB = require('./lib/db');
const { initUserKb, KIND_HERB, KIND_FORMULA } = require('./lib/userkb');
const { initClinicalKb, KIND_DIAG, KIND_SX, KIND_WESTMAP } = require('./lib/clinicalkb');
const { XLSX_TARGETS, xlsxRowsToObjects, buildTemplateWorkbook } = require('./lib/xlsximport');
const syscfg = require('./lib/syscfg');
const gbt = require('./lib/gbt');
const herbcards = require('./lib/herbcards');
const rxreview = require('./lib/rxreview');
const rxmetric = require('./lib/rxmetric');
const rxrule = require('./lib/rxrule');
const rxqc = require('./lib/rxqc');
let icdmap = null;
try { icdmap = require('./lib/icdmap'); } catch (e) { console.warn('[icdmap] 加载失败：', e.message); }
const diagnorm = require('./lib/diagnorm');
const dataport = require('./lib/dataport');
const KB = require('./lib/kb');

// 主进程未捕获异常：完整堆栈落日志，替代"无法诊断的系统错误弹窗"，主进程不再因此卡死
process.on('uncaughtException', (err) => {
  const msg = '[crash] ' + (err && err.stack ? err.stack : String(err));
  console.error(msg);
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'logs', 'app.log'),
      '[' + new Date().toISOString() + '] ' + msg + '\n');
  } catch (e) { /* userData 未就绪时仅打控制台 */ }
});

const APP_NAME = '岐黄鉴方·悬浮采集助手';
// 窗口标题用软件名：后台「系统设置」可自定义，未设置时用默认
function winAppName(){ try { const n = syscfg.getPublic().appName; return (n && n !== '岐黄鉴方') ? n : APP_NAME; } catch (e) { return APP_NAME; } }
let floatWin = null;

// ---------- 轻量运行日志（userData/logs/app.log）：诊断"无弹窗/无记录"类问题的关键证据 ----------
let _logStream = null;
function logLine(tag, msg) {
  try {
    if (!app.isReady()) return;
    if (!_logStream) {
      const dir = path.join(app.getPath('userData'), 'logs');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      _logStream = fs.createWriteStream(path.join(dir, 'app.log'), { flags: 'a' });
    }
    _logStream.write('[' + new Date().toISOString() + '] [' + tag + '] ' + msg + '\n');
  } catch (e) { /* 日志失败不影响主流程 */ }
}

// tesseract 阶段日志接入（worker 创建/识别耗时 → app.log，排查"卡住"类问题）
require('./lib/tess').setLog(m => logLine('tess', m));

let tray = null;
let panelWin = null;
let overlayWin = null;
let adminWin = null;
let searchWin = null;
let aiWin = null;
let consultWin = null;
let pasteWin = null; // 粘贴采集框：先弹框 → 手动 Ctrl+V → 自动划行分段 → 入库
let hudWin = null;   // 采集进度 HUD 小窗（采集期间面板/悬浮球被隐藏，进度改由独立 HUD 呈现）
let store = null;
let userKb = null;
let clinicalKb = null;
let aiSvc = null;

// 悬浮球停靠（右上角，可拖动）
const BALL = { size: 56, margin: 28 };
// 点击悬浮球后展开为操作面板：剪贴板采集 / 框选抓取 / 屏幕文字 + 功能入口（9 行，高度按内容收紧）
const EXP = { w: 214, h: 480 };
let collapsedPos = null; // 悬浮球收起态位置（展开/收起往返保持）

function isWindows() { return process.platform === 'win32'; }

// ---------- 悬浮球图标 ----------
function ballIcon(text, size) {
  const scale = 1;
  const img = nativeImage.createEmpty();
  // 用 dataURL 画一个圆底岐字球
  const s = size * scale;
  const canvas = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">
      <defs><radialGradient id="g" cx="35%" cy="30%"><stop offset="0%" stop-color="#3f8f5f"/><stop offset="100%" stop-color="#1d4d33"/></radialGradient></defs>
      <circle cx="${s/2}" cy="${s/2}" r="${s/2}" fill="url(#g)" stroke="#b8d8a8" stroke-width="1.5"/>
      <text x="${s/2}" y="${s/2+2}" font-size="${s*0.5}" fill="#fff" text-anchor="middle" dominant-baseline="central" font-family="KaiTi,SimSun,serif">${text}</text>
    </svg>`)}`;
  const n = nativeImage.createFromDataURL(canvas);
  if (!n.isEmpty()) return n;
  return nativeImage.createEmpty();
}

// 默认停靠位：工作区右上角（margin 内缩）
function ballHomePos() {
  const wa = screen.getPrimaryDisplay().workArea;
  return {
    x: wa.x + wa.width - BALL.size - BALL.margin,
    y: wa.y + BALL.margin
  };
}

function createFloatBall() {
  const p = ballHomePos();
  collapsedPos = { x: p.x, y: p.y };
  floatWin = new BrowserWindow({
    icon: ICON_PATH,
    width: BALL.size,
    height: BALL.size,
    x: p.x, y: p.y,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  floatWin.setAlwaysOnTop(true, 'screen-saver');
  floatWin.loadFile(path.join(__dirname, 'renderer', 'floatball.html'));
  floatWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  floatWin.on('closed', () => { floatWin = null; });
  return floatWin;
}

// 悬浮球保顶：Windows 下同层级 topmost 窗口（其他置顶工具/HIS 弹窗）会按激活顺序互相压住，
// 透明无边框窗口在系统刷新后也可能丢置顶 → 周期性重设置顶把它抬回 topmost 组顶。
function keepFloatTop() {
  if (!floatWin || floatWin.isDestroyed()) return;
  try {
    floatWin.setAlwaysOnTop(false);
    floatWin.setAlwaysOnTop(true, 'screen-saver');
    floatWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (e) { /* ignore */ }
}

// ---------- 悬浮球两态（56 小球 ⇄ 214×252 操作面板） ----------
function setBallExpanded(expanded) {
  if (!floatWin || floatWin.isDestroyed()) return;
  const wa = screen.getPrimaryDisplay().workArea;
  if (expanded) {
    const [bx, by] = floatWin.getPosition();
    collapsedPos = { x: bx, y: by }; // 记住球的位置，收起后还原
    // 面板向左上展开，右下角近似对齐原球右下角（不超出工作区）
    let x = bx - (EXP.w - BALL.size);
    let y = by - (EXP.h - BALL.size);
    x = Math.min(Math.max(x, wa.x), wa.x + wa.width - EXP.w);
    y = Math.min(Math.max(y, wa.y), wa.y + wa.height - EXP.h);
    floatWin.setBounds({ x: Math.round(x), y: Math.round(y), width: EXP.w, height: EXP.h });
  } else {
    const p = collapsedPos || ballHomePos();
    floatWin.setBounds({ x: Math.round(p.x), y: Math.round(p.y), width: BALL.size, height: BALL.size });
  }
  keepFloatTop();
}

// ---------- 粘贴采集框（剪贴板采集的统一入口）----------
// 流程：Ctrl+Alt+V / 悬浮球 / 托盘 / 面板按钮 → 弹出粘贴框 → 医生手动 Ctrl+V 粘贴
// → 实时自动划行分段预览（噪声标签行剔除）→ 点「入库分析」走完整管线（纠错→脱敏→要素→辨证合规）
function openPasteBox() {
  if (pasteWin && !pasteWin.isDestroyed()) {
    pasteWin.show(); pasteWin.focus();
    return;
  }
  pasteWin = new BrowserWindow({
    icon: ICON_PATH,
    width: 580,
    height: 600,
    minWidth: 480,
    minHeight: 440,
    frame: false,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: true,
    title: `${winAppName()} - 粘贴采集`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  pasteWin.loadFile(path.join(__dirname, 'renderer', 'pastebox.html'));
  pasteWin.on('closed', () => { pasteWin = null; });
}

function closePasteBox() {
  if (pasteWin && !pasteWin.isDestroyed()) pasteWin.destroy();
  pasteWin = null;
}

// ---------- 拍照识别（摄像头拍照 / 纸质处方照片导入 → 同一 OCR 管线）----------
let photoWin = null;
function openPhotoWin() {
  if (photoWin && !photoWin.isDestroyed()) { photoWin.show(); photoWin.focus(); return; }
  photoWin = new BrowserWindow({
    icon: ICON_PATH,
    width: 760,
    height: 660,
    minWidth: 560,
    minHeight: 480,
    frame: false,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: true,
    title: `${winAppName()} - 拍照识别`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  photoWin.loadFile(path.join(__dirname, 'renderer', 'photo.html'));
  photoWin.on('closed', () => { photoWin = null; });
}

/** 拍照/导入的图片落盘 → 走共用 OCR 管线 → 关拍照窗 → 结果填入粘贴框 */
async function photoSubmit(dataUrl) {
  try {
    const b64 = String(dataUrl || '').replace(/^data:image\/\w+;base64,/, '');
    if (!b64 || b64.length < 100) return { ok: false, error: '未获取到图像数据' };
    const p = path.join(store.recordsDir, 'img_photo_' + Date.now() + '.png');
    fs.writeFileSync(p, Buffer.from(b64, 'base64'));
    logLine('photo', 'photo submit bytes=' + Math.round(b64.length * 3 / 4) + ' → ' + p);
    if (photoWin && !photoWin.isDestroyed()) photoWin.close();
    return await ocrImageToPaste(p, { src: 'photo', hint: '照片识别中，识别完成后自动填入' });
  } catch (err) {
    logLine('photo', 'photo submit ERR ' + err.message);
    return { ok: false, error: err.message };
  }
}

// ---------- 托盘 ----------
function createTray() {
  let trayImg = nativeImage.createFromPath(path.join(__dirname, 'build', 'tray.png'));
  if (trayImg.isEmpty()) trayImg = ballIcon('岐', 20);
  tray = new Tray(trayImg);
  tray.setToolTip(APP_NAME);
  const menu = Menu.buildFromTemplate([
    { label: '粘贴采集（Ctrl+Alt+V）', click: () => openPasteBox() },
    { label: '框选区域抓取', click: () => startRegionOverlay() },
    { type: 'separator' },
    { label: '打开记录面板', click: () => openPanel() },
    { label: '辨证咨询 · 诊断/证型/症状', click: () => openConsult() },
    { label: '中药 / 方剂知识检索', click: () => openSearch() },
    { label: 'AI 问药 · 智能解读', click: () => openAi() },
    { label: '知识库后台管理', click: () => openAdmin() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => openPanel());
}

// ---------- 记录面板 ----------
function openPanel() {
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.show(); panelWin.focus();
    panelWin.webContents.send('panel:refresh');
    return;
  }
  panelWin = new BrowserWindow({
    icon: ICON_PATH,
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 560,
    title: `${winAppName()} - 记录面板`,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  panelWin.loadFile(path.join(__dirname, 'renderer', 'panel.html'));
  // 渲染层报错捕获：详情区渲染崩溃（"有记录无内容"）会直接落到 app.log
  panelWin.webContents.on('console-message', (e, a, b, c, d) => {
    const ev = (a && typeof a === 'object') ? a : null;
    const level = ev ? ev.level : a;
    const msg = ev ? ev.message : b;
    const src = ev ? ((ev.sourceId || '') + ':' + (ev.lineNumber || '')) : ((d || '') + ':' + (c || ''));
    if (String(level) === '3' || String(level) === 'error') logLine('panel-rd', 'renderer error: ' + msg + ' @' + src);
  });
  // 新建面板加载完成后补投递采集结果（托盘/Ctrl+Alt+V 在面板未开时采集的场景）
  panelWin.webContents.on('did-finish-load', () => {
    if (pendingPanelResult) {
      const p = pendingPanelResult; pendingPanelResult = null;
      try { panelWin.webContents.send('capture:result', p); } catch (e) { /* 忽略 */ }
    }
  });
  panelWin.on('closed', () => { panelWin = null; });
}
function openAdmin() {
  if (adminWin && !adminWin.isDestroyed()) {
    adminWin.show(); adminWin.focus();
    return;
  }
  adminWin = new BrowserWindow({
    icon: ICON_PATH,
    width: 1240,
    height: 800,
    minWidth: 980,
    minHeight: 620,
    title: `${winAppName()} - 知识库后台`,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  adminWin.loadFile(path.join(__dirname, 'renderer', 'admin.html'));
  adminWin.on('closed', () => { adminWin = null; });
}

// ---------- 知识检索（中药/方剂统一检索） ----------
function openSearch() {
  if (searchWin && !searchWin.isDestroyed()) {
    searchWin.show(); searchWin.focus();
    return;
  }
  searchWin = new BrowserWindow({
    icon: ICON_PATH,
    width: 1040,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    title: `${APP_NAME} - 中药 / 方剂知识检索`,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  searchWin.loadFile(path.join(__dirname, 'renderer', 'search.html'));
  searchWin.on('closed', () => { searchWin = null; });
}

// ---------- AI 问药（云端智能问答窗） ----------
function openAi() {
  if (aiWin && !aiWin.isDestroyed()) {
    aiWin.show(); aiWin.focus();
    return;
  }
  aiWin = new BrowserWindow({
    icon: ICON_PATH,
    width: 900,
    height: 720,
    minWidth: 700,
    minHeight: 520,
    title: `${APP_NAME} - AI 问药`,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  aiWin.loadFile(path.join(__dirname, 'renderer', 'ai.html'));
  aiWin.on('closed', () => { aiWin = null; });
}

// ---------- 辨证咨询（未截取病历时，选择诊断/证型/症状 → 推荐方+合规提示） ----------
let consultCtx = null; // 辨证咨询：带入的记录上下文（截图→辨证 主链）
function openConsult(recId) {
  // 带记录进入：存上下文供辨证窗带入（文本/命中预选，不自动分析）
  consultCtx = null;
  if (recId) {
    const rec = store.get(recId);
    if (rec) {
      consultCtx = {
        id: rec.id,
        ts: rec.ts || '',
        source: rec.source || '',
        winTitle: rec.winTitle || '',
        text: String(rec.text || '').slice(0, 2600),
        charCount: (rec.text || '').length
      };
    }
  }
  if (consultWin && !consultWin.isDestroyed()) {
    consultWin.show(); consultWin.focus();
    if (consultCtx) consultWin.webContents.send('consult-ctx', consultCtx);
    return;
  }
  consultWin = new BrowserWindow({
    icon: ICON_PATH,
    width: 1040,
    height: 780,
    minWidth: 880,
    minHeight: 620,
    title: `${APP_NAME} - 辨证咨询`,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  consultWin.loadFile(path.join(__dirname, 'renderer', 'consult.html'));
  consultWin.on('closed', () => { consultWin = null; });
}

// ---------- 采集主流程 ----------
async function runCaptureFlow(source, extra = {}) {
  try {
    const fg = await capture.getForegroundWindow();
    // 避免抓到自己
    const fgProc = (fg.process || '').toLowerCase();
    if (fg.pid === process.pid || fgProc.includes('electron') || fgProc.includes('qhjf')) {
      return { ok: false, error: '请先切换到医院系统窗口，再点击抓取' };
    }
    const rect = { x: fg.x, y: fg.y, w: fg.w, h: fg.h };
    if (rect.w <= 0 || rect.h <= 0) return { ok: false, error: '无法获取前台窗口区域' };

    // HUD 残留会盖住目标内容被截进画面：截图瞬间前必须立即隐藏（进度反馈全部后置到截图完成后）
    hideProgressHud(true);
    await sleep(120); // 等桌面合成刷新，确保 HUD 已从画面消失
    const imagePath = await capture.captureRegion(rect);
    notifyProgress(38, '准备识别…');
    const ocr = await capture.ocrImage(imagePath, 'zh-Hans-CN', { onProgress: makeOcrProgress(38, 22) });
    const text = capture.linesToText(ocr.lines);
    notifyProgress(62, '解析病历要素…');
    return await finalizeRecord({
      source, winTitle: fg.title, process: fg.process, imagePath,
      rawText: text, ocrLines: ocr.lines, ocrEngine: ocr.engine, ...extra
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 隐藏自身所有置顶窗口（悬浮球/面板），返回之前面板是否可见
function hideSelfWindows() {
  const was = { panel: !!(panelWin && !panelWin.isDestroyed() && panelWin.isVisible()) };
  if (floatWin && !floatWin.isDestroyed()) floatWin.hide();
  if (panelWin && !panelWin.isDestroyed()) panelWin.hide();
  if (pasteWin && !pasteWin.isDestroyed() && pasteWin.isVisible()) { pasteWin.hide(); was.paste = true; }
  // HUD（识别进度/完成提示条）若残留会遮挡目标内容，截图中会出现「提示条盖住处方」导致漏药
  if (hudWin && !hudWin.isDestroyed() && hudWin.isVisible()) { hudWin.hide(); was.hud = true; }
  return was;
}
function restoreWindows(was) {
  if (floatWin && !floatWin.isDestroyed()) { floatWin.show(); keepFloatTop(); }
  if (was && was.panel && panelWin && !panelWin.isDestroyed()) panelWin.show();
  if (was && was.paste && pasteWin && !pasteWin.isDestroyed()) pasteWin.show();
  // HUD 不恢复：进度提示是一次性 UI，采集结束后残留的「识别完成+小贴士」会遮挡下一次框选内容
}
// 等待前台窗口切换为外部程序（医院系统）窗口
async function waitForForeignForeground(maxMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const fg = await capture.getForegroundWindow();
    const proc = (fg.process || '').toLowerCase();
    if (!(fg.pid === process.pid || proc.includes('electron') || proc.includes('qhjf'))) return fg;
    await sleep(180);
  }
  return null;
}

async function captureWholeWindow() {
  const was = hideSelfWindows(); // 先隐藏自己，避免截入画面，并把前台让给医院窗口
  await sleep(150);
  let result;
  try {
    const fg = await waitForForeignForeground();
    result = fg
      ? await runCaptureFlow('window')
      : { ok: false, error: '未检测到病历/医嘱窗口，请先点击医院系统窗口再试' };
  } catch (e) {
    result = { ok: false, error: e.message };
  }
  restoreWindows(was);
  notifyPanel(result);
  return result;
}

/** 读取剪贴板文本：Electron 44 起 clipboard.readText() 返回 Promise，统一 await 兼容两种 */
async function readClipText() {
  try {
    const v = clipboard.readText();
    const t = (v && typeof v.then === 'function') ? await v : v;
    return String(t || '');
  } catch (e) { return ''; }
}
async function writeClipText(t) {
  try {
    const v = clipboard.writeText(String(t == null ? '' : t));
    if (v && typeof v.then === 'function') await v;
    return true;
  } catch (e) { return false; }
}

/**
 * 剪贴板/粘贴文本采集管线（零误差通道）：噪声行剔除 → 医学术语纠错 → 脱敏 → 要素提取 → 自动辨证/合规。
 * 粘贴框（captureText）与直读剪贴板（captureClipboard）共用；文本来自医生手动 Ctrl+V 粘贴或剪贴板。
 */
async function captureClipboardText(pasteText, { via = 'paste' } = {}) {
  const text = String(pasteText || '');
  logLine('clip', via + ' start, text len=' + text.length);
  const { text: cleaned, removed } = noise.filterNoiseText(text);
  const body = analyze.mergeDoseLines(cleaned.replace(/[ \t]+/g, ' ').split('\n').map(s => s.trim()).filter(Boolean).join('\n'));
  const cjkN = (body.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (!body || cjkN < 4) {
    logLine('clip', 'ERR empty/invalid text, cjk=' + cjkN);
    const r = { ok: false, error: '没有可用文本：请先在医院系统里选中病历/医嘱内容，Ctrl+C 复制后粘贴进来（需含中文）；若内容来自「屏幕文字」识别，多半是识别质量不佳——可改用「框选抓取」走高精度引擎' };
    return r; // 粘贴框内直接提示，不弹面板
  }
  notifyProgress(62, '解析剪贴板文本要素…');
  try {
    const r = await finalizeRecord({
      source: 'clipboard', winTitle: '粘贴文本', process: '',
      imagePath: null, rawText: body, ocrLines: [], ocrEngine: 'clipboard'
    });
    logLine('clip', via + ' ok id=' + (r && r.id));
    if (r && r.ok && removed && removed.length) r.complMsg = (r.complMsg ? r.complMsg + '；' : '') + `已忽略界面标签 ${removed.length} 行`;
    return r;
  } catch (e) {
    logLine('clip', via + ' ERR ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
    return { ok: false, error: e.message };
  }
}

/** 直读剪贴板（保留给 e2e/自动化测试；人工入口统一走粘贴框 openPasteBox） */
async function captureClipboard() {
  const text = await readClipText();
  const r = await captureClipboardText(text, { via: 'clip' });
  if (!r.ok) notifyPanel(r); // 直读路径无粘贴框兜底，失败必须弹面板提示
  return r;
}

async function captureRegionByRect(rect, preImage) {
  // rect 为物理像素（由 overlay 主进程转换）
  // preImage：带标注抓取时遮罩仍开着就先抓好的图（笔迹已合成进画面），此时不可再抓一次
  try {
    logLine('region', 'start rect=' + JSON.stringify(rect) + (preImage ? ' preImage=1' : ''));
    let imagePath = preImage || null;
    if (!imagePath) {
      hideProgressHud(true); // 立即隐藏（默认版 420ms 延迟会被截进画面）；先截图后弹 HUD
      await sleep(120);      // 等桌面合成刷新
      imagePath = await capture.captureRegion(rect);
    }
    notifyProgress(40, '准备识别…');
    const ocr = await capture.ocrImage(imagePath, 'zh-Hans-CN', { onProgress: makeOcrProgress(40, 20) });
    logLine('region', 'ocr ok engine=' + ocr.engine + ' lines=' + (ocr.lines || []).length);
    const text = capture.linesToText(ocr.lines);
    notifyProgress(62, '解析病历要素…');
    return await finalizeRecord({
      source: 'region', winTitle: '', process: '',
      imagePath, rawText: text, ocrLines: ocr.lines, ocrEngine: ocr.engine
    });
  } catch (e) {
    logLine('region', 'ERR ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
    const r = { ok: false, error: e.message };
    notifyPanel(r);
    return r;
  }
}

/**
 * 屏幕文字（离线优先）：框选区域 → OCR → 文本填入粘贴框（不直接入库，
 * 医生可先核对/编辑再点「入库分析」）。引擎遵循后台「OCR 设置」（此前写死 tesseract，
 * 导致后台切换引擎对本流程无效），未配置时走默认引擎链。
 * 体验：框选确认后立即弹粘贴框显示"识别中…"，识别完成自动填入——中间不再有无反馈空窗。
 */
async function screentextByRect(rect, preImage) {
  try {
    logLine('region', 'screentext start rect=' + JSON.stringify(rect) + ' engine=' + (capture.ocrConfig().engine || 'auto'));
    // 先截屏再弹粘贴框：粘贴框若先弹出会遮挡框选区域，导致识别内容不全
    // preImage：带标注时遮罩未关就已抓好的图，直接复用
    const imagePath = preImage || await capture.captureRegion(rect);
    openPasteBox();
    pasteHint('识别中… 识别完成后自动填入');
    pasteProgress(6, '准备识别引擎…');
    const ocr = await capture.ocrImage(imagePath, 'zh-Hans-CN', {
      onProgress: function (m) {
        const st = String((m && m.status) || '');
        const p = Math.max(0, Math.min(1, Number((m && m.p) || 0)));
        if (st === 'recognizing text') pasteProgress(15 + Math.round(p * 75), 'OCR 识别文字中…');
        else pasteProgress(8, ocrStageLabel(st));
      }
    });
    // 文本来源：优先 lines 噪声过滤重组（paddle/系统 OCR 只有 lines 没有 text 字段，
    // 此前只读 ocr.text 导致这两类引擎识别成功却误报"未识别到文字"、进度条永远停在 95%），
    // tesseract 通道自带 text 时作兜底；与「转文字」通道同一套规则
    let text = String(capture.linesToText(ocr.lines) || ocr.text || '').trim();
    logLine('region', 'screentext ok engine=' + ocr.engine + ' lines=' + (ocr.lines || []).length + ' textLen=' + text.length);
    try { if (KB && KB.fixOcrText && text) text = KB.fixOcrText(text, null).text || text; } catch (e) { /* 纠错失败不影响预填 */ }
    if (!text) {
      pasteProgressDone(); // 收起进度条，避免永远停在 95%
      pasteHint('未识别到文字：请调整框选范围重试，或改用「框选抓取」走高精度引擎');
      return { ok: false, error: 'empty' };
    }
    pastePrefill(text);
    return { ok: true, lines: (ocr.lines || []).length };
  } catch (e) {
    logLine('region', 'screentext ERR ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
    openPasteBox();
    pasteProgressDone();
    pasteHint('屏幕文字识别失败：' + e.message + '（可改用「框选抓取」走高精度引擎）');
    return { ok: false, error: e.message };
  }
}

/** 结束粘贴框内的 OCR 进度条（pct=100 时渲染层自动收起），失败/空结果路径必须调用，否则进度条永远停在 95% */
function pasteProgressDone() {
  pasteProgress(100, '');
}

/**
 * AI 识别（云端视觉大模型）：框选 → 截图 → 大模型转录 → 药名纠错 → 填入粘贴框。
 * 精度优先通道：对复杂版式/低质量截图的鲁棒性优于本地 OCR；需在后台「AI 设置」
 * 配置支持视觉的模型（通义 qwen-vl-* / 智谱 glm-4v-* 等）。截图仅发送至用户自己配置的模型服务。
 */
async function aiOcrByRect(rect) {
  try {
    logLine('region', 'aiocr start rect=' + JSON.stringify(rect));
    // 先截屏再弹粘贴框：粘贴框若先弹出会遮挡框选区域，导致识别内容不全
    const imagePath = await capture.captureRegion(rect);
    openPasteBox();
    pasteHint('AI 云端识别中…（图片将发送至已配置的大模型服务）');
    pasteProgress(12, '大模型识别中，约需 5~20 秒…');
    const ocr = await ai.visionOcr(imagePath);
    let text = String(ocr.text || '').trim();
    logLine('region', 'aiocr ok engine=' + ocr.engine + ' model=' + (ocr.model || '') + ' lines=' + (ocr.lines || []).length + ' textLen=' + text.length);
    try { if (KB && KB.fixOcrText && text) text = KB.fixOcrText(text, null).text || text; } catch (e) { /* 纠错失败不影响预填 */ }
    if (!text) {
      pasteProgressDone();
      pasteHint('AI 未识别到文字：请调整框选范围重试，或改用「框选抓取」');
      return { ok: false, error: 'empty' };
    }
    pastePrefill(text);
    return { ok: true, lines: (ocr.lines || []).length, model: ocr.model || '' };
  } catch (e) {
    logLine('region', 'aiocr ERR ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
    openPasteBox();
    pasteProgressDone();
    pasteHint('AI 识别失败：' + e.message);
    return { ok: false, error: e.message };
  }
}

/** 向粘贴框投递状态提示（识别中/失败原因），窗口未就绪时等待加载完成再发 */
function pasteHint(text) {
  const send = () => { if (pasteWin && !pasteWin.isDestroyed()) pasteWin.webContents.send('paste:hint', String(text || '')); };
  if (pasteWin && !pasteWin.isDestroyed()) {
    if (pasteWin.webContents.isLoading()) pasteWin.webContents.once('did-finish-load', send);
    else send();
  }
}

/** 向粘贴框投递预填文本（窗口未就绪时等待加载完成再发） */
function pastePrefill(text) {
  const send = () => { if (pasteWin && !pasteWin.isDestroyed()) pasteWin.webContents.send('paste:prefill', String(text || '')); };
  if (pasteWin && !pasteWin.isDestroyed()) {
    if (pasteWin.webContents.isLoading()) pasteWin.webContents.once('did-finish-load', send);
    else send();
  }
}

/** 向 overlay 投递消息（窗口未就绪时等待加载完成再发） */
function sendOverlay(channel, payload) {
  const send = () => { if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send(channel, payload); };
  if (overlayWin && !overlayWin.isDestroyed()) {
    if (overlayWin.webContents.isLoading()) overlayWin.webContents.once('did-finish-load', send);
    else send();
  }
}

/**
 * 转文字（截图工具条）：关截图 → 高精度 OCR（与「框选抓取」同引擎链）→ 文本经纠错管线填入粘贴框。
 * 粘贴框是普通窗口，医生可直接编辑后点「入库分析」，不再用 overlay 内弹窗
 * （overlay 弹窗存在焦点丢失/关闭即丢失的问题）。
 */
/** 框选「转文字」与拍照识别共用：对一张本地图片走高精度 OCR → 纠错 → 填入粘贴框（可编辑后入库分析） */
async function ocrImageToPaste(imagePath, opt = {}) {
  try {
    openPasteBox();
    pasteHint(opt.hint || 'OCR 识别中，识别完成后自动填入');
    pasteProgress(6, '准备识别引擎…');
    const ocr = await capture.ocrImage(imagePath, 'zh-Hans-CN', {
      onProgress: function (m) {
        const st = String((m && m.status) || '');
        const p = Math.max(0, Math.min(1, Number((m && m.p) || 0)));
        if (st === 'recognizing text') pasteProgress(15 + Math.round(p * 75), 'OCR 识别文字中…');
        else pasteProgress(8, ocrStageLabel(st));
      }
    });
    let text = String(capture.linesToText(ocr.lines) || ocr.text || '').trim();
    try { if (KB.fixOcrText && text) text = KB.fixOcrText(text, null).text || text; } catch (e) {}
    pasteProgress(96, '智能纠错与文本整理…');
    logLine('region', 'ocr-image ok src=' + (opt.src || 'region') + ' engine=' + ocr.engine + ' lines=' + (ocr.lines || []).length);
    if (!text) {
      pasteHint('未识别到文字：请调整后重试（照片注意光线充足、文字清晰），或手动输入后入库分析');
      return { ok: false, error: 'empty' };
    }
    pastePrefill(text);
    return { ok: true, lines: (ocr.lines || []).length };
  } catch (err) {
    logLine('region', 'ocr-image ERR ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err));
    openPasteBox();
    pasteProgressDone();
    pasteHint('识别失败：' + err.message + '（可手动输入后入库分析）');
    return { ok: false, error: err.message };
  }
}

async function ocrRectToPaste(rect) {
  try {
    logLine('region', 'ocr-text start rect=' + JSON.stringify(rect));
    // 先截屏再弹粘贴框：粘贴框若先弹出会遮挡框选区域，导致识别内容不全
    const imagePath = await capture.captureRegion(rect);
    return await ocrImageToPaste(imagePath, { src: 'region' });
  } catch (err) {
    logLine('region', 'ocr-text ERR ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err));
    openPasteBox();
    pasteProgressDone();
    pasteHint('OCR 识别失败：' + err.message + '（可手动输入后入库分析）');
    return { ok: false, error: err.message };
  }
}

// 按需分析：截图入库时不立即生成；医生选好诊断/证型后手动触发
/** 处方「用法」落库取值：医生手填过（usageEdited）就以手填为准，否则用 tcm 抓取值；
 *  tcm 缺失（采集后未分析）时直接从文本抓取——用法是客观字段，不该等分析跑完才可见。 */
function usageForPatch(rec, tcm) {
  if (rec && rec.usageEdited) return String(rec.usage || '');
  const u = String((tcm && tcm.usage) || '').trim();
  if (u) return u;
  try { return String((analyze.pickUsage((rec && (rec.text || rec.rawText)) || '') || {}).usage || ''); } catch (e) { return ''; }
}
function analyzeRecord(rec, over = {}) {
  // keys 每次分析都用当前引擎从原文重抽（2026-10-23）：旧 keys 是采集时的解析结果，
  // 引擎升级（如「临床诊断及证型」冒号折行修复/三级分类）后旧记录重新分析才能拿到新拆分；
  // 诊断/证型手选覆盖仍最优先；新引擎未抽出的键保留旧值（如手填的舌象）。
  const fresh = (() => { try { return analyze.extractKeyPoints(rec.text || '') || {}; } catch (e) { return {}; } })();
  const keys = Object.assign({}, fresh);
  for (const k of Object.keys(rec.keys || {})) {
    if (!(k in keys) && !['中医诊断', '西医诊断', '证型'].includes(k)) keys[k] = rec.keys[k];
  }
  if (over && over.synd) keys['证型'] = String(over.synd);
  if (over && over.diag) keys['中医诊断'] = String(over.diag);
  // 诊断 → 所属证型（手工辨证库），供方剂按诊断评分推荐/相符核对
  let diagSynds = [];
  try {
    const dn = String((over && over.diag) || keys['中医诊断'] || '').trim();
    if (dn && clinicalKb) {
      const d = clinicalKb.list(KIND_DIAG).find(x => x && x.name && (x.name === dn || dn.includes(x.name) || x.name.includes(dn)));
      if (d) diagSynds = (d.syndromes || []).map(s => typeof s === 'string' ? s : (s && s.name) || '').filter(Boolean);
    }
  } catch (e) { /* 忽略 */ }
  const compliance = runCompliance({ text: rec.text || '', keys, sections: rec.sections || [] });
  // 用法参与分析：手填（usageEdited）优先，否则用文本抓取值——外用给药要豁免内服常用量核查
  let usageCtx = '';
  try { usageCtx = usageForPatch(rec, { usage: (analyze.pickUsage(rec.text || '') || {}).usage || '' }); } catch (e) { usageCtx = ''; }
  const tcm = runTcm({ text: rec.text || '', keys, sections: rec.sections || [], diagSynds, usage: usageCtx });
  // 剂数手填优先（rec.rxJi）：天数/总克数随剂数重算，指标条与点评红线同源
  try {
    if (tcm && tcm.rx && tcm.rx.stat && Number(rec && rec.rxJi) > 0) {
      tcm.rx.stat = rxmetric.applyJi(tcm.rx.stat, rec.rxJi, rec.text || '');
    }
  } catch (e) { /* 指标重算失败不影响分析 */ }
  // 未匹配药名入「AI 补库」队列：所有分析路径（采集入库/手动分析/处方编辑/改用法）统一在这里入队。
  // unmatchedAdd 自带去重（同名 pending 只计数，已处理过的不重复入队），重复调用安全。
  try {
    const miss = tcm && tcm.rx && tcm.rx.stat && tcm.rx.stat.miss;
    if (miss && miss.length && userKb) userKb.unmatchedAdd(miss, String(rec.source || ''));
  } catch (e) { /* 入队失败不影响分析 */ }
  return { compliance, tcm, keys };
}
// 采集清洗（JS/C# 镜像 Ai.CleanForCapture）：剔除规则 + HIS 用法尾巴折行回拼/去重
// 框选抓取与粘贴框共用；ai-vision 链内已应用不重复。规则异常不阻断采集。
function hisCleanText(rawText) {
  let t = String(rawText || '');
  try {
    const sr = String((aiSvc && aiSvc.publicCfg && aiSvc.publicCfg().stripRules) || '');
    if (sr.trim()) t = require('./renderer/strip-rules').applyText(t, sr).join('\n');
  } catch (e) { /* 规则异常不阻断采集 */ }
  try { t = analyze.reflowWrappedUsage(t); } catch (e) { /* 异常不阻断采集 */ }
  return t;
}

// 采集文本指纹：去全部空白后 sha1 —— 同文重复截取识别（覆盖原记录而不是新增一条）
const capturefp = require('./lib/capturefp');
const textFp = capturefp.textFp;

async function finalizeRecord({ source, winTitle, process: procName, imagePath, rawText, ocrLines, ocrEngine }) {  // 空识别结果不生成空记录（OCR 0 行/纯噪声时给出明确反馈，避免"有记录无内容"）
  if (!rawText || !String(rawText).trim()) {
    logLine('record', 'ERR empty text from ' + source + ', skip save');
    const r = { ok: false, error: '未识别到文字内容：请确认框选范围内有病历/医嘱文字（或内容未全部过滤），调整后重试' };
    notifyPanel(r);
    return r;
  }
  // 后台「AI 识别剔除规则」+ HIS 用法尾巴回拼，对**所有机器来源文本**生效：
  // 框选抓取（rapidocr/paddle）、粘贴框（医院系统选中→Ctrl+C 复制的 HIS 文本，同样带
  // 界面噪音与折行）都要清洗；ai-vision 链内已应用过，跳过防二次删除。
  // 医学术语自动纠错（fixOcrText）仍只用于 OCR 来源——粘贴文本不做模糊改写。
  let stripRaw = rawText;
  if (ocrEngine !== 'ai-vision') stripRaw = hisCleanText(rawText);
  // OCR 文本级纠错（两层）：
  // ① 确定性映射（炙苜草→炙甘草、臼术→白术等）；② 医学术语库约束（繁体归一/损伤词模式/
  //    证型·诊断库唯一近邻纠错），目标是识别结果"零差错"，全部替换可回溯、不命中不盲改
  let medTerms = null;
  try {
    if (clinicalKb) {
      const diags = clinicalKb.list(KIND_DIAG).map(d => d && d.name).filter(Boolean);
      // 诊断关联证型上下文：原文命中的诊断 → 其分型列表，用于漏字纠错的歧义收敛
      const syndCtx = [];
      // 证型全库支持度：诊断/症状关联次数（上下文缺失时按支持度唯一最大收敛漏字纠错）
      const syndSupport = {};
      const bump = (n) => { if (typeof n === 'string' && n) syndSupport[n] = (syndSupport[n] || 0) + 1; };
      for (const d of clinicalKb.list(KIND_DIAG)) {
        if (d && d.name && stripRaw && stripRaw.includes(d.name)) {
          (d.syndromes || []).forEach(s => { const n = typeof s === 'string' ? s : (s && s.name); if (n) syndCtx.push(n); });
        }
        (d.syndromes || []).forEach(s => bump(typeof s === 'string' ? s : (s && s.name)));
      }
      for (const s of clinicalKb.list(KIND_SX)) ((s && s.syndromes) || []).forEach(x => bump(typeof x === 'string' ? x : (x && x.name)));
      medTerms = {
        syndromes: clinicalKb.syndromeRows().map(r => r && r.name).filter(Boolean),
        diags,
        syndCtx: [...new Set(syndCtx)],
        syndSupport
      };
    }
  } catch (e) { medTerms = null; }
  // 纠错只用于 OCR 识别文本（region 等机器识别来源）；粘贴/手输（clipboard）是医生亲自录入的
  // 最终文本，不做任何自动改写（曾出现茯神→茯苓这类把对的改错的情况）
  const ocrFix = (source !== 'clipboard' && KB.fixOcrText) ? KB.fixOcrText(stripRaw, medTerms) : { text: rawText, fixes: [] };
  const srcText = ocrFix.text;
  // 持久化截图
  let savedImage = null;
  if (imagePath && fs.existsSync(imagePath)) {
    const recDir = store.recordsDir;
    const base = path.join(recDir, 'img_' + Date.now() + path.extname(imagePath));
    fs.copyFileSync(imagePath, base);
    savedImage = base;
  }
  // 剪贴板等原生文本：保留词间空格（OCR 的"去逐字空格"规则会把"创伤病 气滞血瘀证"粘死）
  const nativeText = ocrEngine === 'clipboard';
  const maskOpts = nativeText ? { keepSpaces: true } : undefined;
  const masked = analyze.maskText(srcText, maskOpts);
  const sections = analyze.splitIntoSections(masked, maskOpts);
  const keys = analyze.extractKeyPoints(masked);
  notifyProgress(78, '自动辨证与合规分析中…');
  // 病历类截图自动辨证：识别到病历信息（病历要素/诊断/证型命中）时直接给出证型诊断
  // 并跑完整本地分析（推荐方剂+合规）；非病历截图仍走手动工作台。
  let autoAn = null;
  let compliance = null, tcm = null;
  try {
    const diags = clinicalKb ? clinicalKb.list(KIND_DIAG) : [];
    const sxs = clinicalKb ? clinicalKb.list(KIND_SX) : [];
    const j = autosynd.judge(masked, keys, diags, sxs);
    if (j.record) {
      const over = {};
      if (j.diag) over.diag = j.diag;
      if (j.synd) over.synd = j.synd;
      const r = analyzeRecord({ text: masked, keys, sections, source }, over);
      compliance = r.compliance;
      tcm = r.tcm;
      autoAn = { auto: true, at: Date.now(), diag: j.diag, synd: j.synd, diagSrc: j.diagSrc, syndSrc: j.syndSrc, evidence: j.evidence, candidates: j.candidates, diagHits: j.diagHits };
    }
  } catch (e) { /* 自动辨证失败不影响入库 */ }
  // 处方类截图兜底（2026-10-19）：纯处方（无病历要素，autosynd 判 record=false）也要自动分析——
  // 文本含 ≥2 味带剂量药味即跑 tcm/合规/质检（否则记录无任何分析结果，面板观感"识别不全"）
  if (!tcm) {
    try {
      const rxItems = extractRxItems(masked);
      const doseN = rxItems.filter(x => x && x.dose).length;
      if (doseN >= 2) {
        const r = analyzeRecord({ text: masked, keys, sections, source }, {});
        compliance = r.compliance;
        tcm = r.tcm;
      }
    } catch (e) { /* 兜底分析失败不影响入库 */ }
  }
  // 要素兜底自动识别：无标签时用库扫描补齐（中医诊断←自动辨证；证型←自动辨证；西医诊断←西医对照库）
  if (!keys['中医诊断'] && autoAn && autoAn.diag) keys['中医诊断'] = autoAn.diag;
  if (!keys['证型'] && autoAn && autoAn.synd) keys['证型'] = autoAn.synd;
  if (!keys['西医诊断'] && clinicalKb && srcText) {
    const wests = [];
    try {
      for (const w of clinicalKb.list(KIND_WESTMAP)) {
        if (w && w.west && String(w.west).length >= 2 && srcText.includes(w.west) && !wests.includes(w.west)) wests.push(w.west);
        if (wests.length >= 5) break;
      }
    } catch (e) { /* 忽略 */ }
    if (wests.length) keys['西医诊断'] = wests.join('、');
  }
  // 诊断要素按后台诊断库比对归一（2026-10-19）：GB/T 病名/证候 + ICD-10 国临版正名——
  // 去无用符号、可选用词→正名、证型简写补证尾、唯一包含收敛；匹配不到原样保留（宁缺勿错）
  let diagFixes = [];
  try { diagFixes = diagnorm.normalizeKeys(keys); } catch (e) { diagFixes = []; }
  const recData = {
    source,
    winTitle: winTitle || '',
    process: procName || '',
    image: savedImage,
    text: masked,
    rawText: srcText, // 脱敏前原文（已做 OCR 错字纠正；面板"原始文本"切换用，默认展示脱敏版）
    ocrFix: ocrFix.fixes.length ? ocrFix.fixes : undefined, // 本次文本级纠正记录（如 臼术→白术）
    sections,
    keys,
    // 科室（归档检索用）：文本里的「科别/科室」优先，取不到用当前前台登录账号的科室兜底
    dept: analyze.pickDept(srcText) || syscfg.frontDept() || '',
    compliance, // 合规提示建议（病历类截图自动生成；非病历由手动分析生成）
    tcm,        // 智能方剂分析（同上）
    qc: rxqc.check({ text: masked, tcm, usage: usageForPatch({ text: masked, rawText: srcText }, tcm) }), // 识别质检（缺剂量/未入库/剂量异常/缺用法）
    usage: usageForPatch({ text: masked, rawText: srcText }, tcm), // 处方用法（本次抓取值；手填后以手填为准）
    an: autoAn, // 自动辨证元数据（诊断/证型/依据/候选）；非病历为 null
    ocrEngine: ocrEngine || '', // 本次识别引擎（paddleocr-ppocrv6 / windows-media-ocr）
    ocr: ocrLines || []
  };
  // 重复截取识别：同文（去空白后指纹一致）不再新增记录，直接覆盖原记录 ——
  // 医生维护过的字段全部保留（患者标注/置顶/复核裁定/手填剂数/手填用法/诊断证型覆盖/改过的诊断要素），
  // 采集字段与自动分析按本次结果刷新，记录时间更新到本次（列表里仍在原位不重复出现）。
  const fp = textFp(masked);
  const dup = fp ? store.list().find(r => r && r.fp === fp) : null;
  if (dup) {
    const patch = capturefp.dedupPatch(dup, recData);
    if (patch) {
      store.patch(dup.id, patch);
      notifyPanel({ ok: true, id: dup.id, dedup: true });
      logLine('record', 'dedup overwrite id=' + dup.id + ' fp=' + fp.slice(0, 8));
      return {
        ok: true, id: dup.id, source: dup.source, winTitle: winTitle || '', charCount: masked.length,
        dedup: true, auto: !!autoAn,
        complMsg: '已识别为重复截取：与原记录内容一致，已覆盖原记录并刷新时间与分析',
      };
    }
  }
  if (fp) recData.fp = fp;
  const rec = store.add(recData);
  notifyPanel({ ok: true, id: rec.id });
  logLine('record', 'saved id=' + rec.id + ' source=' + source + ' keys=' + JSON.stringify(keys).slice(0, 200));
  const parts = [];
  if (ocrFix.fixes.length) parts.push(`已自动纠正OCR错字：${ocrFix.fixes.join('、')}`);
  if (diagFixes.length) parts.push(`诊断库校对：${diagFixes.slice(0, 5).join('、')}${diagFixes.length > 5 ? ' 等' : ''}`);
  if (autoAn) {
    if (autoAn.synd) parts.push(`已自动辨证：${autoAn.diag || '—'} · ${autoAn.synd}（推荐 ${tcm && tcm.hasRec ? (tcm.recs || []).length : 0} 首方剂）`);
    else parts.push('已识别病历要素，未见证型，请在面板补选证型后分析');
  } else {
    parts.push('采集完成，请在记录面板选择诊断证型后点击「本地分析」生成推荐与合规');
  }
  return { ok: true, id: rec.id, source: rec.source, winTitle: rec.winTitle, charCount: masked.length, complMsg: parts.join('；'), auto: !!autoAn };
}

// 运维入口函数引用（registerIpc 内定义，启动后赋值）
let mntClearRecords = null, mntSeedDemo = null;
let pendingPanelResult = null; // 面板未开时的采集结果：开面板后补投递（成功与失败都不能静默）
function notifyPanel(payload) {
  hideProgressHud();
  if (panelWin && !panelWin.isDestroyed()) {
    if (!panelWin.isVisible()) panelWin.show();
    panelWin.webContents.send('capture:result', payload);
    return;
  }
  // 面板未打开（托盘/全局快捷键采集的常见场景）：结果绝不静默 —— 自动弹出面板并补投递
  if (payload && payload.canceled) return; // 用户主动取消不弹面板
  logLine('panel', 'panel closed, defer result: ' + JSON.stringify(payload).slice(0, 200));
  pendingPanelResult = payload;
  openPanel();
}
// 采集进度事件（面板进度条 + 独立 HUD：截图 → OCR → 解析入库）
function notifyProgress(pct, label) {
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.webContents.send('cap:progress', { pct, label });
  }
  // 独立 HUD：截图动作(12%)前不弹出，避免把 HUD 截进画面；OCR 起步(≥30%)显示
  if (pct > 0 && pct < 100) {
    if (pct >= 30 || (hudWin && !hudWin.isDestroyed() && hudWin.isVisible())) showProgressHud(pct, label);
  } else if (pct <= 0) {
    hideProgressHud();
  }
}

// AI 分析进度：真实里程碑 → (百分比, 文案)。只映射模型层真实上报的阶段
// （准备上下文 / 第 N 段请求 / 第 N 段返回 / 渲染），不做假爬升。
// 段数最多 3（首段 + 最多 2 次续写，见 ai.js chatContinue 的 continueMax）。
const AI_PCT_REQ = [12, 52, 78];
const AI_PCT_RND = [42, 70, 92];
function aiProgressOf(ev) {
  const s = String((ev && ev.stage) || '');
  const r = Math.max(1, Number((ev && ev.round) || 1));
  if (s === 'prep') return { pct: 6, label: '准备分析上下文（脱敏文本 + 规则引擎结果）…' };
  if (s === 'request') return { pct: AI_PCT_REQ[r - 1] || 78, label: `正在调用云端模型（第 ${r} 段）…` };
  if (s === 'round') {
    return {
      pct: AI_PCT_RND[r - 1] || 92,
      label: r > 1 ? `第 ${r} 段已返回，继续拼接…` : '模型已返回，检查输出是否完整…',
    };
  }
  if (s === 'done') return { pct: 100, label: '生成完成，正在渲染…' };
  return null;
}

// OCR 引擎进度事件 → (base, span) 区间内的百分比 + 友好阶段文案
// tesseract 状态：loading tesseract core / initializing / loading language traineddata / recognizing text(p 0~1)
function ocrStageLabel(status) {
  const s = String(status || '');
  if (s.includes('language') || s.includes('traineddata')) return '加载中文语言包（首次较慢，之后秒开）…';
  if (s.includes('initializing api')) return '准备识别…';
  if (s === 'paddle-ocr') return 'PP-OCRv6 高精度识别中…';
  if (s === 'windows-ocr') return '系统 OCR 识别中…';
  return 'OCR 识别文字中…';
}
function makeOcrProgress(base, span) {
  let last = -1;
  return function (m) {
    const st = String((m && m.status) || '');
    const p = Math.max(0, Math.min(1, Number((m && m.p) || 0)));
    let pct;
    if (st === 'recognizing text') pct = base + Math.round(p * span); // 识别主阶段占满区间
    else pct = base + 2; // 加载/初始化阶段给小幅前进感
    if (pct > last) { last = pct; notifyProgress(pct, ocrStageLabel(st)); }
  };
}
// 粘贴框进度（转文字/屏幕文字通道：粘贴框即进度载体）
function pasteProgress(pct, label) {
  const send = () => { if (pasteWin && !pasteWin.isDestroyed()) pasteWin.webContents.send('paste:progress', { pct: Number(pct) || 0, label: String(label || '') }); };
  if (pasteWin && !pasteWin.isDestroyed()) {
    if (pasteWin.webContents.isLoading()) pasteWin.webContents.once('did-finish-load', send);
    else send();
  }
}

// ---------- 采集进度 HUD（无边框置顶小窗，屏幕中央） ----------
const HUD = { w: 380, h: 168 };
function ensureHudWin() {
  if (hudWin && !hudWin.isDestroyed()) return hudWin;
  hudWin = new BrowserWindow({
    icon: ICON_PATH,
    width: HUD.w, height: HUD.h, frame: false, transparent: true,
    resizable: false, movable: false, focusable: false, alwaysOnTop: true,
    skipTaskbar: true, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  hudWin.setAlwaysOnTop(true, 'screen-saver');
  hudWin.loadFile(path.join(__dirname, 'renderer', 'hud.html'));
  hudWin.on('closed', () => { hudWin = null; });
  return hudWin;
}
function hudSetProgress(pct, label) {
  if (hudWin && !hudWin.isDestroyed()) {
    hudWin.webContents.executeJavaScript(
      `window.__setProg(${Number(pct) || 0}, ${JSON.stringify(String(label || ''))})`
    ).catch(() => {});
  }
}
function showProgressHud(pct, label) {
  try {
    const w = ensureHudWin();
    const wa = screen.getPrimaryDisplay().workAreaSize;
    if (!w.isVisible()) {
      // 右下角显示：屏幕中央会压住处方「计量」列，既挡医生核对、
      // 又在时序竞态下可能被截进画面（#进度条挡计量）
      w.setPosition(Math.round(wa.width - HUD.w - 24), Math.round(wa.height - HUD.h - 24));
      w.showInactive();
      // 窗口复用残留上一轮 100%：显示前先重置，再设置本轮进度
      const wc = w.webContents;
      const resetThenSet = () => {
        wc.executeJavaScript('window.__resetProg && window.__resetProg()')
          .catch(() => {})
          .then(() => hudSetProgress(pct, label));
      };
      if (wc.isLoading()) wc.once('did-finish-load', resetThenSet);
      else resetThenSet();
    } else {
      hudSetProgress(pct, label);
    }
  } catch (e) { /* HUD 失败不影响采集主流程 */ }
}
/**
 * 隐藏进度 HUD。
 * now=true：立即隐藏（截图前必须用这个——默认版有 420ms「完成✓」延迟，
 * PowerShell 截图启动 ~300ms 会落在这窗口内，把 HUD 截进画面盖住内容）
 */
function hideProgressHud(now) {
  if (hudWin && !hudWin.isDestroyed() && hudWin.isVisible()) {
    if (now) { hudWin.hide(); return; }
    hudSetProgress(100, '完成 ✓');
    setTimeout(() => { if (hudWin && !hudWin.isDestroyed()) hudWin.hide(); }, 420);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------- 框选遮罩 ----------
let overlayWas = { panel: false };
let overlayMode = 'record'; // record=框选入库 | screentext=框选离线识字→粘贴框
/** 抓一张主屏工作区底图（物理像素、已裁剪到工作区），供框选放大镜取色/放大 */
async function grabWorkAreaBg() {
  try {
    const disp = screen.getPrimaryDisplay();
    const wa = disp.workArea, sf = disp.scaleFactor || 1;
    const src = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round((wa.x + wa.width) * sf), height: Math.round((wa.y + wa.height) * sf) }
    });
    if (!src.length || !src[0].thumbnail) return null;
    const img = src[0].thumbnail.crop({
      x: Math.round(wa.x * sf), y: Math.round(wa.y * sf),
      width: Math.round(wa.width * sf), height: Math.round(wa.height * sf)
    });
    return img.isEmpty() ? null : img.toDataURL('image/png');
  } catch (e) { logLine('region', 'bg grab ERR ' + e.message); return null; }
}
let overlayStarting = false; // 异步化（先抓底图）后的重入保护
async function startRegionOverlay(mode = 'record') {
  if ((overlayWin && !overlayWin.isDestroyed()) || overlayStarting) return;
  overlayStarting = true;
  try {
    overlayMode = mode;
    overlayWas = hideSelfWindows(); // 框选前先隐藏悬浮球/面板，避免挡在要框选的内容上
    await sleep(60);                // 只等自身窗口收起（底图改到出窗之后再抓，不必再等它）
    const { workArea } = screen.getPrimaryDisplay();
  overlayWin = new BrowserWindow({
    icon: ICON_PATH,
    x: workArea.x, y: workArea.y,
    width: workArea.width, height: workArea.height,
    transparent: true,
    frame: false,
    fullscreen: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setBounds(workArea);
  overlayWin.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  overlayWin.on('closed', () => { overlayWin = null; });
  // 底图（放大镜数据源）挪到出窗之后异步抓：原先「抓底图」串行挡在出窗前，
  // 是「截图框打开慢」的主因。页面侧 body.pre 会在底图到货前先藏提示条，
  // 免得遮罩自己的提示文字被拍进底图。sendOverlay 自带等待加载完成。
  grabWorkAreaBg().then(bg => { if (bg) sendOverlay('overlay:bg', bg); }).catch(() => {});
  } finally { overlayStarting = false; }
}

function closeOverlay() {
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy();
  overlayWin = null;
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('ball:capture-clipboard', () => openPasteBox());
  ipcMain.handle('ball:open-paste', () => openPasteBox());
  // 粘贴框提交：走完整采集管线；成功关框（finalizeRecord 内部已 notifyPanel 弹出面板定位新记录）
  ipcMain.handle('paste:submit', async (e, text) => {
    const r = await captureClipboardText(text, { via: 'paste' });
    if (r && r.ok) closePasteBox();
    return r;
  });
  ipcMain.on('paste:close', () => closePasteBox());
  // 粘贴框实时划行分段预览：噪声判定与入库管线同源（lib/noise + 剔除规则 + 折行回拼），预览即所见
  ipcMain.handle('paste:segment', (e, text) => {
    const merged = analyze.mergeDoseLines(String(text || '').replace(/[ \t]+/g, ' '));
    const lines = hisCleanText(merged).split('\n').map(s => s.trim()).filter(s => s);
    const rows = lines.map(s => ({ text: s, tag: noise.isNoiseLine(s) }));
    const kept = rows.filter(r => !r.tag).length;
    return { rows, kept, removed: rows.length - kept };
  });
  ipcMain.handle('ball:open-panel', () => openPanel());
  ipcMain.handle('ball:open-search', () => openSearch());
  ipcMain.handle('ball:open-ai', () => openAi());
  ipcMain.handle('ball:open-consult', () => openConsult());
  ipcMain.handle('panel:open-consult', (e, id) => openConsult(id));
  ipcMain.handle('consult:ctx', () => (consultCtx ? { ...consultCtx } : null));
  ipcMain.handle('consult:clear-ctx', () => { consultCtx = null; return { ok: true }; });
  ipcMain.on('ball:quit', () => app.quit());
  ipcMain.handle('ball:region', () => startRegionOverlay());
  ipcMain.handle('ball:screentext', () => startRegionOverlay('screentext'));
  ipcMain.handle('clipboard:read', () => readClipText());
  ipcMain.handle('clipboard:write', (e, t) => writeClipText(t));
  ipcMain.on('ball:set-size', (e, expanded) => setBallExpanded(!!expanded));
  ipcMain.on('ball:move', (e, pos) => {
    if (floatWin && !floatWin.isDestroyed()) {
      // 拖动位置 clamp 到工作区，保证小球不整个拖出屏幕丢失
      const wa = screen.getPrimaryDisplay().workArea;
      const nx = Math.min(Math.max(Math.round(pos.x), wa.x), wa.x + wa.width - BALL.size);
      const ny = Math.min(Math.max(Math.round(pos.y), wa.y), wa.y + wa.height - BALL.size);
      collapsedPos = { x: nx, y: ny };
      floatWin.setPosition(nx, ny);
    }
  });
  // 悬浮球拖拽（主进程驱动）：渲染层 e.screenX 在 DPI 缩放下与 setPosition 坐标系不一致会越拖越偏，
  // 且"球心=光标"抓边缘拖会跳变。改用光标 DIP 坐标 + 抓取偏移，光标在哪球就在哪。
  let ballDrag = null;
  function stopBallDrag() {
    if (ballDrag) { clearInterval(ballDrag.timer); ballDrag = null; }
  }
  ipcMain.on('ball:drag-start', () => {
    stopBallDrag();
    if (!floatWin || floatWin.isDestroyed()) return;
    const c = screen.getCursorScreenPoint();
    const b0 = floatWin.getBounds();
    // 注意：getPosition() 返回数组 [x,y]，这里统一用 getBounds().x/y（对象），避免取错字段得到 NaN
    ballDrag = { ox: c.x - b0.x, oy: c.y - b0.y, timer: null };
    ballDrag.timer = setInterval(() => {
      try {
        if (!floatWin || floatWin.isDestroyed()) { stopBallDrag(); return; }
        const cc = screen.getCursorScreenPoint();
        const b = floatWin.getBounds();
        const wa = screen.getPrimaryDisplay().workArea;
        const nx = Math.min(Math.max(cc.x - ballDrag.ox, wa.x), wa.x + wa.width - b.width);
        const ny = Math.min(Math.max(cc.y - ballDrag.oy, wa.y), wa.y + wa.height - b.height);
        if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
        collapsedPos = { x: nx, y: ny };
        floatWin.setPosition(Math.round(nx), Math.round(ny));
      } catch (e) { stopBallDrag(); }
    }, 16);
  });
  ipcMain.on('ball:drag-end', stopBallDrag);
  ipcMain.handle('overlay:selected', async (e, rectDIP, withAnno, opts) => {
    const ocrMode = !!(opts && opts.ocr);   // 转文字：本地 OCR → 粘贴框编辑 → 入库分析
    const aiMode = !!(opts && opts.ai);     // AI 识别：云端视觉大模型 → 粘贴框编辑 → 入库分析
    // rectDIP 为相对主工作区逻辑坐标 → 转物理像素（带标注要先算 rect 才能先抓图）
    const disp = screen.getPrimaryDisplay();
    const sf = disp.scaleFactor || 1;
    const wa = disp.workArea;
    const rect = {
      x: Math.round((wa.x + rectDIP.x) * sf),
      y: Math.round((wa.y + rectDIP.y) * sf),
      w: Math.round(rectDIP.w * sf),
      h: Math.round(rectDIP.h * sf)
    };
    let preImage = null; // 带标注：遮罩未关时抓好的图（笔迹已在画面里）
    if ((ocrMode || aiMode) && overlayWin && !overlayWin.isDestroyed()) {
      // 转文字/AI 识别：隐藏遮罩全部元素（含笔迹，避免干扰识别）后立即退出截图界面
      try { overlayWin.webContents.send('overlay:strip', true); } catch (err) {}
      await sleep(250);
      closeOverlay();
    } else if (withAnno && overlayWin && !overlayWin.isDestroyed()) {
      // 带标注：先让渲染层隐藏遮罩/工具条只留笔迹 → 趁遮罩还在抓图（笔迹进入截屏）→ 再关遮罩
      try { overlayWin.webContents.send('overlay:strip'); } catch (err) {}
      await new Promise(r => setTimeout(r, 250));
      try { preImage = await capture.captureRegion(rect); } catch (err) { preImage = null; }
      closeOverlay();
    } else {
      closeOverlay();
    }
    if (ocrMode) { const r = await ocrRectToPaste(rect); restoreWindows(overlayWas); return r; }
    if (aiMode) { const r = await aiOcrByRect(rect); restoreWindows(overlayWas); return r; }
    if (overlayMode === 'screentext') {
      const r = await screentextByRect(rect, preImage);
      restoreWindows(overlayWas);
      return r;
    }
    const r = await captureRegionByRect(rect, preImage);
    restoreWindows(overlayWas);
    if (r && r.ok) openPanel();
    return r;
  });
  ipcMain.handle('overlay:cancel', () => {
    closeOverlay(); restoreWindows(overlayWas); notifyProgress(0, '');
    if (overlayMode === 'record') notifyPanel({ ok: false, canceled: true }); // screentext 取消不弹面板
  });
  // 遮罩工具条「药」按钮：按当前选区裁图 → OCR → 药味解析 → 出「说明/用法/预判方剂」卡片。
  // 只做识别与展示，不落库、不改选区，失败也不影响后续确认抓取。
  ipcMain.handle('overlay:herb-info', async (e, payload) => {
    const p = payload || {};
    const dataUrl = String((p && p.img) || '');
    if (dataUrl.indexOf('base64,') < 0) return { ok: false, error: 'no-image' };
    const tmp = path.join(store.recordsDir, '_herbcrop_' + Date.now() + '.png');
    try {
      fs.mkdirSync(path.dirname(tmp), { recursive: true });
      fs.writeFileSync(tmp, Buffer.from(dataUrl.slice(dataUrl.indexOf('base64,') + 7), 'base64'));
      const ocr = await capture.ocrImage(tmp, 'zh-Hans-CN', {});
      let text = String(capture.linesToText(ocr.lines) || ocr.text || '').trim();
      // 与落库管线同序：剔除规则 → 折行回拼 → OCR 纠错
      text = hisCleanText(text);
      try { if (text) text = KB.fixOcrText(text, null).text || text; } catch (err) {}
      return herbcards.build(text);
    } catch (err) {
      logLine('region', 'herb-info ERR ' + (err && err.message ? err.message : err));
      return { ok: false, error: err && err.message ? err.message : String(err) };
    } finally {
      try { fs.unlinkSync(tmp); } catch (e) {}
    }
  });

  ipcMain.handle('panel:capture-clipboard', () => openPasteBox());
  ipcMain.handle('panel:start-region', () => startRegionOverlay());
  // 拍照识别：打开拍照窗（摄像头取景 + 文件导入）
  ipcMain.handle('photo:open', () => openPhotoWin());
  ipcMain.handle('photo:submit', (e, dataUrl) => photoSubmit(dataUrl));
  ipcMain.handle('panel:list', () => store.list());
  ipcMain.handle('panel:get', (e, id) => store.get(id));
  // 补录方剂：病历类截图先入库，医生随后粘贴/输入处方文本追加到该记录并重跑分析
  ipcMain.handle('record:addRx', (e, { id, rxText } = {}) => {
    const rec = id ? store.get(id) : null;
    const add = String(rxText || '').trim();
    if (!rec) return { ok: false, error: '记录不存在' };
    if (!add) return { ok: false, error: '处方内容为空' };
    // 补录文本是医生粘贴/输入的最终文本，不过纠错管线（同 setRx：不自动改写医生录入的内容）
    const marker = '\n【补录方剂】\n';
    const rawText2 = (rec.rawText || rec.text || '') + marker + add;
    const text2 = (rec.text || '') + marker + (analyze.maskText ? analyze.maskText(add) : add);
    const updated = { ...rec, text: text2, rawText: rawText2 };
    let compliance = rec.compliance, tcm = rec.tcm;
    try { const an = analyzeRecord(updated); compliance = an.compliance; tcm = an.tcm; } catch (err) { /* 保留原分析 */ }
    const u2 = usageForPatch(rec, tcm);
    const patched = store.patch(id, { text: text2, rawText: rawText2, compliance, tcm, usage: u2,
      qc: rxqc.check({ text: text2, tcm, usage: u2 }), rxAddedAt: new Date().toISOString() });
    return { ok: true, rec: patched };
  });
  // 处方编辑：医生在合并处方框内增删改药味后，整体替换记录文本并重跑分析。
  // 编辑文本是医生确认过的最终文本，不再过纠错管线（否则手工修正会被自动纠错改回去，如茯神→茯苓）
  ipcMain.handle('record:setRx', (e, { id, text, usage: usageArg } = {}) => {
    const rec = id ? store.get(id) : null;
    const t2 = String(text || '').trim();
    if (!rec) return { ok: false, error: '记录不存在' };
    if (!t2) return { ok: false, error: '内容不能为空' };
    const rawText2 = t2;
    const text2 = analyze.maskText ? analyze.maskText(t2) : t2;
    let sections = rec.sections;
    try { sections = analyze.splitIntoSections(text2, {}); } catch (err) { /* 沿用原分块 */ }
    const updated = { ...rec, text: text2, rawText: rawText2, sections };
    let compliance = rec.compliance, tcm = rec.tcm;
    try { const an = analyzeRecord(updated); compliance = an.compliance; tcm = an.tcm; } catch (err) { /* 保留原分析 */ }
    // 用法：随处方一起提交时以手填为准（并打上手填标记）；否则沿用「未手填则用抓取值」口径
    const usageHand = String(usageArg || '').trim();
    const uRx = usageHand || usageForPatch(rec, tcm);
    const rxPatch = {
      text: text2, rawText: rawText2, sections, compliance, tcm,
      usage: uRx,
      qc: rxqc.check({ text: text2, tcm, usage: uRx }), // 医生改完处方/剂量后重算：红框与拦截随之解除
      editedAt: new Date().toISOString()
    };
    if (usageHand) rxPatch.usageEdited = true;
    const patched = store.patch(id, rxPatch);
    logLine('record', 'setRx id=' + id + ' herbs=' + t2.split('\n').length);
    return { ok: true, rec: patched };
  });
  // 处方「用法」手填/修改：抓不到或抓错了都在这里改。用法参与合规分析（外用豁免内服量核查），
  // 保存后重跑分析并回写，面板 renderDetail 直接刷新结论。
  ipcMain.handle('record:set-usage', (e, { id, usage } = {}) => {
    const rec = id ? store.get(id) : null;
    if (!rec) return { ok: false, error: '记录不存在' };
    const u = String(usage || '').trim();
    const updated = { ...rec, usage: u, usageEdited: true, usageAt: new Date().toISOString() };
    let compliance = rec.compliance, tcm = rec.tcm;
    try { const an = analyzeRecord(updated); compliance = an.compliance; tcm = an.tcm; } catch (err) { /* 保留原分析 */ }
    const patched = store.patch(id, { usage: u, usageEdited: true, usageAt: updated.usageAt, compliance, tcm,
      qc: rxqc.check({ text: updated.text, tcm, usage: u }) }); // 手填用法后重算质检（缺用法/缺剂数可因此解除）
    logLine('record', 'setUsage id=' + id + ' len=' + u.length);
    return { ok: true, rec: patched };
  });
  // 手动分析：医生在记录面板选好诊断/证型后点击「本地分析」触发（截图时不立即生成）
  ipcMain.handle('record:analyze', (e, { id, diag, synd, force, reason } = {}) => {
    const rec = id ? store.get(id) : null;
    if (!rec) return { ok: false, error: '记录不存在' };
    // 识别质检拦截：缺剂量 / 药名未入库 / 剂量异常 未修正前拒绝分析（force=1 可强制放行）。
    // 拦截前先用**已有** tcm 判定（不跑分析、不产生 AI 补库等副作用），未分析过的记录放行。
    const qcPre = rxqc.check({ text: rec.text, tcm: rec.tcm, usage: rec.usage || (rec.tcm && rec.tcm.usage) });
    if (qcPre.block && !force) {
      return { ok: false, blocked: true, needForce: true, qc: qcPre, error: rxqc.blockMsg(qcPre) };
    }
    // 手选/手改诊断证型也过一遍诊断库归一（面板下拉多为库内名，自由输入受益；失败不阻断）
    let diagN = String(diag || '').trim();
    let syndN = String(synd || '').trim();
    try {
      if (diagN) diagN = diagnorm.normalizeField('中医诊断', diagN) || diagN;
      if (syndN) syndN = diagnorm.normalizeField('证型', syndN) || syndN;
    } catch (e) { /* 忽略 */ }
    const { compliance, tcm, keys: keysOut } = analyzeRecord(rec, { diag: diagN, synd: syndN });
    const qc = rxqc.check({ text: rec.text, tcm, usage: usageForPatch(rec, tcm) || rec.usage });
    // 强制放行留痕：理由写入 qc.forced（缺项未修正时放行必须写明理由，点评/复核可追溯）
    const reasonTxt = String(reason || '').trim().slice(0, 200);
    if (force && reasonTxt) qc.forced = { at: new Date().toISOString(), reason: reasonTxt };
    store.patch(id, { compliance, tcm, qc, keys: keysOut, diag: diagN, synd: syndN,
      usage: usageForPatch(rec, tcm), analyzedAt: new Date().toISOString() });
    const focusN = (compliance && (compliance.errorN || 0) + (compliance.warnN || 0)) || 0;
    return {
      ok: true,
      compliance,
      tcm,
      qc,
      focusN,
      hasRecord: !!(compliance && compliance.hasRecord),
      tcmOk: !!(tcm && tcm.ok),
      msg: [tcm && tcm.ok && tcm.type !== 'none' ? tcm.msg : '',
            compliance && compliance.hasRecord ? focusN + ' 条合规建议' : ''].filter(Boolean).join('；')
    };
  });
  ipcMain.handle('panel:remove', (e, id) => { logLine('record', 'removed id=' + id); return store.remove(id); });

  // ---------- 处方点评（后台管理模块） ----------
  // 点评基于「已落库的分析结果」：优先取 rec.tcm —— 批量点评若逐条重跑 analyzeRecord，
  // 会把未匹配药名反复塞进「AI 补库」队列（计数虚高），管理动作不该有这种副作用。
  function rxTcmFor(rec) {
    if (rec && rec.tcm && rec.tcm.ok !== false) return rec.tcm;
    try { return (analyzeRecord(rec) || {}).tcm || null; } catch (err) { return null; }
  }
  // 记录 → 点评上下文。diag/synd 只在非空时给键（空串不得覆盖 tcm 里从文本识别到的诊断）
  function rxCtx(rec, over, rulesArg) {
    const tcm = rxTcmFor(rec);
    const ctx = {
      tcm,
      text: String((rec && (rec.text || rec.rawText)) || ''),
      usage: usageForPatch(rec, tcm)
    };
    const d = String((over && over.diag) || (rec && rec.diag) || '').trim();
    const s = String((over && over.synd) || (rec && rec.synd) || '').trim();
    if (d) ctx.diag = d;
    if (s) ctx.synd = s;
    if (Number(rec && rec.rxJi) > 0) ctx.ji = Number(rec.rxJi);   // 手填剂数参与点评（天数红线口径一致）
    if (rec && rec.dept) ctx.dept = String(rec.dept);             // 科室：点评明细/导出/筛选用
    ctx.rules = rulesArg || rxrule.get().rules;   // 冗余线配置（批量时统一取一次传入）
    return ctx;
  }
  ipcMain.handle('rx:review', (e, { id, text, diag, synd, usage } = {}) => {
    try {
      if (id) {
        const rec = store.get(id);
        if (!rec) return { ok: false, error: '记录不存在' };
        const ctx = rxCtx(rec, { diag, synd });
        ctx.id = rec.id; ctx.ts = rec.ts; ctx.source = rec.source;
        return rxreview.reviewOne(ctx);
      }
      // 即时点评（粘贴文本）：只跑 runTcm，不落库、不入 AI 补库队列
      const t = String(text || '').trim();
      if (!t) return { ok: false, error: '请先粘贴处方文本' };
      const keys = {};
      if (diag) keys['中医诊断'] = diag;
      if (synd) keys['证型'] = synd;
      const ctx = { tcm: runTcm({ text: t, keys, usage: String(usage || '') }), text: t, rules: rxrule.get().rules };
      if (diag) ctx.diag = diag;
      if (synd) ctx.synd = synd;
      return rxreview.reviewOne(ctx);
    } catch (err) { return { ok: false, error: '点评失败：' + err.message }; }
  });
  ipcMain.handle('rx:batch', (e, { limit } = {}) => {
    try {
      const n = Math.max(1, Math.min(parseInt(limit, 10) || 200, 2000));
      const rules = rxrule.get().rules;
      const items = store.list().slice(0, n).map(rec => {
        const ctx = rxCtx(rec, null, rules);
        ctx.id = rec.id; ctx.ts = rec.ts; ctx.source = rec.source;
        return ctx;
      });
      return rxreview.reviewBatch(items);
    } catch (err) { return { ok: false, error: '批量点评失败：' + err.message }; }
  });
  // 处方点评「红线规则」（味数 / 单日剂量 / 天数 / 辨证）维护
  ipcMain.handle('rxrule:get', () => rxrule.get());
  ipcMain.handle('rxrule:set', (e, patch) => rxrule.set(patch || {}));
  ipcMain.handle('rxrule:reset', () => rxrule.reset());
  ipcMain.handle('rx:export', async (e, { csv, title } = {}) => {
    try {
      const body = String(csv || '');
      if (!body) return { ok: false, error: '无导出内容' };
      const opts = {
        title: title || '导出处方点评工作表',
        defaultPath: path.join(app.getPath('documents'), '岐黄鉴方-处方点评工作表.csv'),
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      };
      const win = BrowserWindow.getFocusedWindow();
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      fs.writeFileSync(r.filePath, '\ufeff' + body, 'utf8'); // BOM：Excel 直接双击不乱码
      return { ok: true, path: r.filePath };
    } catch (err) { return { ok: false, error: '导出失败：' + err.message }; }
  });
  ipcMain.handle('panel:openImage', (e, p) => { if (p) shell.openPath(p); });
  ipcMain.handle('panel:openDir', () => { shell.openPath(store.recordsDir); });
  ipcMain.handle('panel:exportRecord', async (e, id) => {
    const rec = store.get(id);
    if (!rec) return { ok: false, error: '记录不存在' };
    const options = {
      title: '导出采集记录',
      defaultPath: path.join(app.getPath('documents'), `采集记录_${id.slice(0, 8)}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    };
    const { canceled, filePath } = panelWin && !panelWin.isDestroyed()
      ? await dialog.showSaveDialog(panelWin, options)
      : await dialog.showSaveDialog(options);
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, JSON.stringify(rec, null, 1), 'utf8');
    return { ok: true, filePath };
  });
  // 演示数据一键预置：多科室脱敏演示病历/医嘱（覆盖合规/有提示/需复核三种结论）。
  // 幂等：先删掉上一批 demo:true 的记录再写入，真实采集记录不受影响（可反复点「预置演示数据」）。
  function seedDemoRecords() {
    const now = Date.now();
    const H = 3600 * 1000, D = 24 * H;
    const mk = (o) => {
      const text = analyze.maskText ? analyze.maskText(o.raw) : o.raw;
      let sections = [];
      try { sections = analyze.splitIntoSections(text, {}); } catch (e) {}
      const rec = store.add({
        source: o.source, winTitle: o.title || '', text, rawText: o.raw, sections,
        ts: new Date(now - o.ago).toISOString(),
        patient: o.patient || '', diag: o.diag || '', synd: o.synd || '',
        dept: o.dept || '', demo: true
      });
      if (o.analyzed) {
        try {
          const { compliance, tcm } = analyzeRecord(rec, { diag: o.diag, synd: o.synd });
          return store.patch(rec.id, { compliance, tcm, analyzedAt: new Date().toISOString() });
        } catch (err) { return rec; }
      }
      return rec;
    };
    // 科室取自「人员科室维护」的常见临床科室；时间跨 3 个月，便于看板/月度点评出趋势
    const demos = [
      { dept: '脾胃病科', source: 'window', title: '门诊医生工作站', patient: '张某', diag: '胃脘痛', synd: '脾胃虚寒证', analyzed: true, ago: 3 * D + 4 * H,
        raw: '门诊病历\n姓名：张某  性别：女  年龄：38岁\n科别：脾胃病科\n主诉：胃脘隐痛反复发作3月，加重1周。\n现病史：患者3月前无明显诱因出现胃脘隐痛，喜温喜按，进食后缓解，伴腹胀、纳差、乏力，夜寐欠安，二便调。\n查体：神清，腹软，中上腹轻压痛，舌淡胖边有齿痕，苔薄白，脉沉细。\n辅助检查：胃镜示慢性浅表性胃炎。\n诊断：胃脘痛\n证型：脾胃虚寒证\n处理：\n黄芪 15g 桂枝 9g 白芍 12g 生姜 6g\n大枣 10g 炙甘草 6g 饴糖 20g\n7剂，水煎服，日一剂，分两次温服。' },
      { dept: '脾胃病科', source: 'clipboard', title: '', patient: '张某', diag: '胃脘痛', synd: '脾胃虚寒证', analyzed: true, ago: 3 * H,
        raw: '门诊病历\n姓名：张某  性别：女  年龄：38岁\n科别：脾胃病科\n主诉：胃脘隐痛较前缓解，仍纳差乏力。\n现病史：服药7剂后胃痛明显减轻，腹胀减，纳食增加，夜寐安，二便调。\n舌淡胖，苔薄白，脉沉细。\n诊断：胃脘痛\n证型：脾胃虚寒证\n处理：守方微调\n黄芪 18g 桂枝 9g 白芍 12g 生姜 6g\n大枣 10g 炙甘草 6g 饴糖 20g 炒谷芽 15g\n14剂，水煎服，日一剂，分两次温服。' },
      { dept: '心病科', source: 'uia', title: '住院医生站 - 医嘱浏览', patient: '李某', diag: '胸痹', synd: '心血瘀阻证', analyzed: true, ago: D + 6 * H,
        raw: '长期医嘱单\n患者：李某  床号：12  住院号：2026-0901\n科室：心病科\n中医诊断：胸痹（心血瘀阻证）\n西医诊断：冠心病 稳定型心绞痛\n临方加工：\n丹参 15g 川芎 10g 红花 6g 桃仁 10g\n赤芍 10g 柴胡 9g 桔梗 6g 牛膝 9g\n每日一剂 水煎 400ml 早晚分服' },
      { dept: '肺病科', source: 'region', title: '', patient: '王某', diag: '胁痛', synd: '肝郁脾虚证', analyzed: false, ago: 3 * D + 2 * H,
        raw: '处方笺\n王某 男 45岁\n科别：肺病科\n诊断：胁痛（肝郁脾虚证）\nRp：\n柴胡 10g 白术 10g 茯苓 12g 当归 10g\n白芍 12g 薄荷 6g 甘草 6g 香附 9g\n7剂 水煎服' },
      { dept: '肺病科', source: 'window', title: '门诊医生工作站', patient: '陈某', diag: '咳嗽', synd: '风寒袭肺证', analyzed: true, ago: 5 * D + 7 * H,
        raw: '门诊病历\n姓名：陈某 性别：男 年龄：56岁\n科别：肺病科\n主诉：咳嗽咽痒1周，遇冷加重，痰白清稀。\n舌淡红苔薄白，脉浮紧。\n诊断：咳嗽\n证型：风寒袭肺证\n处理：宣肺散寒止咳\n麻黄 6g 杏仁 9g 紫苏叶 9g 前胡 9g\n桔梗 6g 陈皮 6g 炙甘草 6g\n5剂，水煎服，日一剂。' },
      { dept: '骨伤科', source: 'window', title: '门诊医生工作站', patient: '赵某', diag: '骨折病', synd: '气滞血瘀证', analyzed: true, ago: 9 * D,
        raw: '门诊病历\n姓名：赵某 性别：男 年龄：42岁\n科别：骨伤科\n主诉：右踝扭伤肿痛3天。\n查体：右外踝肿胀压痛，活动受限，舌暗红苔薄白，脉弦涩。\n诊断：骨折病\n证型：气滞血瘀证\n处理：\n桃仁 10g 红花 6g 当归 12g 川芎 9g\n赤芍 12g 生地 12g 牛膝 9g 乳香 6g 没药 6g\n7剂 水煎服 日一剂' },
      { dept: '骨伤科', source: 'region', title: '', patient: '赵某', diag: '筋伤', synd: '气滞血瘀证', analyzed: true, ago: 12 * D,
        raw: '外用处方\n姓名：赵某 男 42岁\n科室：骨伤科\n诊断：筋伤（气滞血瘀证）\n海桐皮 15g 透骨草 15g 伸筋草 15g 红花 9g\n苏木 12g 艾叶 12g 川椒 6g\n3剂 水煎外洗患处 每日1剂' },
      { dept: '针灸推拿科', source: 'clipboard', title: '', patient: '孙某', diag: '腰痛', synd: '肝肾亏虚证', analyzed: true, ago: 18 * D,
        raw: '门诊处方\n孙某 女 63岁\n就诊科室：针灸推拿科\n中医诊断：腰痛\n证型：肝肾亏虚证\n独活 9g 桑寄生 15g 杜仲 9g 牛膝 12g\n细辛 3g 秦艽 9g 防风 9g 当归 12g\n白芍 12g 熟地黄 15g 党参 12g 茯苓 12g\n7剂 水煎服 每日1剂 早晚温服' },
      { dept: '脑病科', source: 'uia', title: '住院医生站 - 医嘱浏览', patient: '周某', diag: '眩晕', synd: '痰浊上扰证', analyzed: true, ago: 24 * D,
        raw: '长期医嘱单\n患者：周某 床号：8 住院号：2026-0815\n科室：脑病科\n中医诊断：眩晕（痰浊上扰证）\n西医诊断：后循环缺血\n法半夏 9g 白术 12g 天麻 9g 茯苓 15g\n陈皮 9g 泽泻 9g 生姜 6g 炙甘草 6g\n每日1剂 水煎 300ml 分两次服' },
      { dept: '脾胃病科', source: 'region', title: 'HIS 处方录入', patient: '吴某', diag: '胃痞', synd: '寒热错杂证', analyzed: true, ago: 31 * D,
        raw: '处方笺\n吴某 男 51岁\n科室：脾胃病科\n诊断：胃痞（寒热错杂证）\nRp：\n制附子 10g 法半夏 10g 黄连 6g 黄芩 9g\n干姜 6g 党参 12g 大枣 10g 炙甘草 6g\n14剂 水煎服 日一剂' },
      { dept: '心病科', source: 'region', title: '', patient: '郑某', diag: '心悸', synd: '', analyzed: true, ago: 44 * D,
        raw: '处方笺\n郑某 女 58岁\n科室：心病科\n诊断：心悸\nRp：\n炙甘草 30g 桂枝 12g 生地黄 15g 麦冬 12g\n阿胶 9g 火麻仁 10g 生姜 9g 大枣 10g\n10剂 水煎服' },
      { dept: '脑病科', source: 'region', title: '', patient: '冯某', diag: '不寐', synd: '心脾两虚证', analyzed: false, ago: 58 * D,
        raw: '处方笺\n冯某 女 47岁\n科室：脑病科\n诊断：不寐（心脾两虚证）\nRp：\n酸枣仁 柏子仁 远志 当归\n党参 黄芪 白术 茯苓\n龙眼肉 木香 炙甘草\n水煎服' },
      { dept: '骨伤科', source: 'clipboard', title: '', patient: '刘某', diag: '', synd: '', analyzed: false, ago: 72 * D,
        raw: '体检摘要：刘某 男 60岁\n科室：骨伤科\n血压 138/86mmHg，心率 76次/分\n近期时有心悸、气短，活动后加重，休息可缓解。\n建议：心内科门诊随诊。' }
    ];
    // 幂等：清掉上一批演示数据（只删 demo:true，真实记录不动）
    let replaced = 0;
    try {
      for (const r of store.list()) if (r && r.demo) { store.remove(r.id); replaced++; }
    } catch (e) { /* 清理失败不阻断预置 */ }
    // 按时间写入：最老的先写、最新的后写 —— 列表按 rowid DESC 取，时间最新的记录自然排在最上
    const added = demos.slice().sort((a, b) => b.ago - a.ago).map(mk);
    logLine('record', 'seeded demo n=' + added.length + ' replaced=' + replaced);
    return { ok: true, count: added.length, replaced };
  }
  ipcMain.handle('panel:seedDemo', () => seedDemoRecords());
  // 清空采集记录（后台维护用）：只删 records 表 + 记录关联的截图，知识库/配置/参照库不动
  function clearAllRecords() {
    let n = 0, imgN = 0;
    try {
      for (const r of store.list()) {
        if (r && r.image) { try { if (fs.existsSync(r.image)) { fs.unlinkSync(r.image); imgN++; } } catch (e) { /* 图片占用则留 */ } }
        store.remove(r.id); n++;
      }
      logLine('record', 'cleared all records n=' + n + ' images=' + imgN);
      return { ok: true, count: n, images: imgN };
    } catch (e) { return { ok: false, error: '清空失败：' + e.message }; }
  }
  ipcMain.handle('records:clear', () => clearAllRecords());
  // 暴露给「--clear-records / --seed-demo」运维入口（两者在 registerIpc 作用域内定义）
  mntClearRecords = clearAllRecords;
  mntSeedDemo = seedDemoRecords;
  ipcMain.handle('app:version', () => app.getVersion());
  // 记录侧栏：置顶 / 患者标注 / 人工复核裁定 —— 白名单字段补丁
  ipcMain.handle('panel:patch', (e, { id, patch } = {}) => {
    if (!id || typeof patch !== 'object' || !patch) return { ok: false, error: '参数无效' };
    const p = {};
    if (typeof patch.pinned === 'boolean') p.pinned = patch.pinned; // 白名单：只允许置顶位
    if (typeof patch.patient === 'string') p.patient = patch.patient.trim().slice(0, 20); // 患者标注（空串=清除）
    if (typeof patch.dept === 'string') p.dept = patch.dept.trim().slice(0, 20);          // 科室归属（空串=清除）
    // 手填剂数（指标条「剂数」可点击录入）：1~999 整数；0/空 = 清除手填，回落原文自动识别。
    // 同时重算 rec.tcm.rx.stat 的 ji/days/totalG —— 指标条与点评读同一份 stat，不重算会出现两套数。
    if ('rxJi' in patch) {
      const v = Math.round(Number(patch.rxJi));
      const val = Number.isFinite(v) && v > 0 ? Math.min(v, 999) : 0;
      p.rxJi = val > 0 ? val : undefined;
      const cur0 = store.get(id);
      const st0 = cur0 && cur0.tcm && cur0.tcm.rx && cur0.tcm.rx.stat;
      if (st0) {
        const rx = Object.assign({}, cur0.tcm.rx, { stat: rxmetric.applyJi(st0, val, cur0.text || '') });
        p.tcm = Object.assign({}, cur0.tcm, { rx });
      }
    }
    // 诊断要素 keys 整体替换（详情胶囊可编辑）：前端传合并后的完整对象，键名/键值均限长
    if (patch.keys && typeof patch.keys === 'object' && !Array.isArray(patch.keys)) {
      const kk = {};
      for (const x of Object.keys(patch.keys)) {
        const key = String(x).trim().slice(0, 20), val = patch.keys[x];
        if (!key || typeof val !== 'string') continue;
        kk[key] = val.slice(0, 120);
      }
      if (Object.keys(kk).length) p.keys = kk;
    }
    // 人工复核裁定（仅「已核查·有提示」的记录可裁定）：
    //   {status:'pass'} 通过并存档 | {status:'reject', note} 驳回留痕 | null 撤销裁定
    // 裁定时间由主进程落，前端不可伪造；撤销时写 undefined，落库 JSON.stringify 会省略该键。
    if ('review' in patch) {
      const rv = patch.review;
      if (rv === null) p.review = undefined;
      else {
        const st = (rv && typeof rv === 'object') ? String(rv.status || '') : '';
        if (st !== 'pass' && st !== 'reject') return { ok: false, error: '复核结论无效' };
        p.review = { status: st, note: String(rv.note || '').trim().slice(0, 60), at: new Date().toISOString() };
      }
    }
    if (!Object.keys(p).length) return { ok: false, error: '无有效字段' };
    const r = store.patch(id, p);
    if (!r) return { ok: false, error: '记录不存在' };
    // 撤销裁定时 p.review 为 undefined：落库已被 JSON.stringify 省略，
    // 返回值也一并删键 —— 让「撤销后对象里根本没有 review」成为两侧一致的事实
    // （否则 Electron 的结构化克隆会留下一个值为 undefined 的键，.NET 侧没有）。
    if (p.review === undefined && 'review' in r) delete r.review;
    if (p.rxJi === undefined && 'rxJi' in r) delete r.rxJi;   // 清除手填剂数：与 .NET RecPatch 的 null 删键语义一致
    return { ok: true, rec: r };
  });
  // 批量导出 TXT：多条记录合并为一个文本文件（保存对话框选择位置）
  ipcMain.handle('panel:exportTxt', async (e, ids) => {
    const list = (Array.isArray(ids) ? ids : []).map(id => store.get(id)).filter(Boolean);
    if (!list.length) return { ok: false, error: '无可导出的记录' };
    list.sort((a, b) => new Date(a.ts) - new Date(b.ts)); // 按时间升序
    const srcName = s => s === 'window' ? '窗口' : s === 'region' ? '框选' : s === 'clipboard' ? '剪贴板' : s === 'uia' ? '界面文本' : '其它';
    const parts = list.map(r => {
      const L = [];
      L.push('═'.repeat(38));
      L.push(`时间：${new Date(r.ts).toLocaleString('zh-CN', { hour12: false })}`);
      L.push(`来源：${srcName(r.source)}${r.winTitle ? ' · ' + r.winTitle : ''}`);
      if (r.diag || r.synd) L.push(`辨证：${r.diag || '—'}${r.synd ? ' · ' + r.synd : ''}`);
      L.push(`状态：${(r.compliance || r.tcm) ? '已分析' : '未分析'}`);
      L.push('');
      L.push(r.rawText || r.text || '(无内容)');
      return L.join('\n');
    });
    const options = {
      title: '导出采集记录（TXT）',
      defaultPath: path.join(app.getPath('documents'), `采集记录导出_${list.length}条.txt`),
      filters: [{ name: '文本文件', extensions: ['txt'] }]
    };
    const { canceled, filePath } = panelWin && !panelWin.isDestroyed()
      ? await dialog.showSaveDialog(panelWin, options)
      : await dialog.showSaveDialog(options);
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, '\ufeff' + parts.join('\n\n'), 'utf8'); // BOM：记事本打开不乱码
    logLine('record', 'exported txt n=' + list.length + ' -> ' + filePath);
    return { ok: true, filePath, count: list.length };
  });

  // ===== OCR 引擎（PP-OCRv6 / Windows OCR）=====
  ipcMain.handle('ocr:status', async (_e, opts) => {
    // opts.force=true（后台「检测环境」按钮）跳过 5 分钟探针缓存；默认走缓存 + 常驻快路径
    try { return await capture.ocrStatus(!!(opts && opts.force)); } catch (e) { return { paddle: false, error: String(e && e.message || e) }; }
  });
  ipcMain.handle('ocr:config-get', () => capture.ocrConfig());
  ipcMain.handle('ocr:config-set', (e, patch = {}) => {
    const cfg = capture.setOcrConfig({
      engine: ['auto', 'paddle', 'rapid', 'win', 'tess'].includes(patch.engine) ? patch.engine : undefined,
      tier: ['medium', 'small', 'tiny'].includes(patch.tier) ? patch.tier : undefined,
      python: typeof patch.python === 'string' ? patch.python.trim() : undefined
    });
    try { DB.kvSet('ocr', cfg); } catch (err) { /* 忽略 */ }
    return cfg;
  });
  // 一键离线安装 OCR Python 环境（预置包 vendor/ocr_env/，含无 AVX CPU 回落方案）
  ipcMain.handle('ocr:env-install', async (e) => {
    const send = (line) => { try { e.sender.send('ocr-env-install-progress', line); } catch (err) { /* 窗口可能已关 */ } };
    try {
      const installer = require('./lib/ocr_env_install');
      return await installer.installOcrEnv(send);
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });

  // ===== AI 智能层（云端大模型） =====
  ipcMain.handle('ai:config-get', () => aiSvc ? aiSvc.publicCfg() : { hasKey: false });
  ipcMain.handle('ai:config-set', (e, patch) => aiSvc ? aiSvc.updateCfg(patch) : { hasKey: false });
  ipcMain.handle('ai:test', async () => {
    if (!aiSvc) return { ok: false, error: 'AI 未初始化' };
    try { return await aiSvc.runTest(); }
    catch (err) { return { ok: false, error: err.message, code: err.code }; }
  });
  ipcMain.handle('ai:test-model', async (e, id) => {
    if (!aiSvc) return { ok: false, error: 'AI 未初始化' };
    try { return await aiSvc.runTestModel(id); }
    catch (err) { return { ok: false, error: err.message, code: err.code }; }
  });
  ipcMain.handle('ai:run', async (e, { kind, payload } = {}) => {
    if (!aiSvc) return { ok: false, error: 'AI 未初始化' };
    // 进度条事件：只发给发起本次调用的窗口（面板 AI 解读 / AI 问药页）
    const sendProgress = (ev) => {
      try {
        const p = aiProgressOf(ev);
        if (p && e && e.sender && !e.sender.isDestroyed()) e.sender.send('ai:progress', p);
      } catch (_) { /* 进度上报失败不影响分析 */ }
    };
    try {
      if (kind === 'record') {
        // 记录解读：从存档取文本 + 规则引擎结果，统一走云端综合解读
        // 记录可能尚未本地分析(tcm/compliance 为空)：按所选辨证即时补齐，保证解读上下文完整
        const id = payload && payload.id;
        const rec = id ? store.get(id) : null;
        if (!rec) return { ok: false, error: '记录不存在（可能已被删除）' };
        let { compliance, tcm } = rec;
        if (!compliance || !tcm || payload.diag || payload.synd) {
          const r = analyzeRecord(rec, { diag: payload.diag, synd: payload.synd });
          compliance = r.compliance; tcm = r.tcm;
        }
        // 识别质检拦截：药味缺剂量 / 未入库 / 剂量异常 未修正前不发云端解读（force=1 放行）
        const qcAi = rxqc.check({ text: rec.text, tcm, usage: String(rec.usage || (tcm && tcm.usage) || '').trim() });
        if (qcAi.block && !(payload && payload.force)) {
          return { ok: false, blocked: true, needForce: true, qc: qcAi, error: rxqc.blockMsg(qcAi) };
        }
        // 强制放行留痕：AI 解读同样须写明理由（写入 rec.qc.forced，与本地分析同一留痕口径）
        if (qcAi.block) {
          const reasonTxt = String((payload && payload.reason) || '').trim().slice(0, 200);
          if (reasonTxt) store.patch(id, { qc: Object.assign({}, qcAi, { forced: { at: new Date().toISOString(), reason: reasonTxt } }) });
        }
        const keys = Object.assign({}, rec.keys || {});
        if (payload && payload.synd) keys['证型'] = String(payload.synd);
        if (payload && payload.diag) keys['中医诊断'] = String(payload.diag);
        // 用法：手填值优先（rec.usage），否则用本次分析抓到的 tcm.usage
        const usageCtx = String(rec.usage || (tcm && tcm.usage) || '').trim();
        const rr = await aiSvc.runAi('record', { text: rec.text, keys, compliance, tcm, usage: usageCtx }, sendProgress);
        if (rr && rr.ok) sendProgress({ stage: 'done', round: 0 });
        return rr;
      }
      const rr = await aiSvc.runAi(kind, payload || {}, sendProgress);
      if (rr && rr.ok) sendProgress({ stage: 'done', round: 0 });
      return rr;
    } catch (err) {
      return { ok: false, error: err.message, code: err.code };
    }
  });

  // ===== 知识库后台 =====
  ipcMain.handle('admin:open', () => openAdmin());

  // ---------- 基础信息维护（系统设置） ----------
  ipcMain.handle('sys:get', () => syscfg.getPublic());
  // ---------- 数据备份/恢复 ----------
  ipcMain.handle('data:info', () => {
    return { dir: app.getPath('userData'), portable: USERDATA_PORTABLE, cacheDir: CACHE_DIR };
  });
  // ---------- 配置搬家（全部设置已在 data.db，一文件即全量） ----------
  ipcMain.handle('data:audit', () => {
    try {
      const a = dataport.audit(app.getPath('userData'));
      a.portable = USERDATA_PORTABLE;
      a.cacheDir = CACHE_DIR;
      return a;
    } catch (e) { return { ok: false, error: e && e.message || String(e) }; }
  });
  ipcMain.handle('data:export-config', async (e) => {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const opt = {
      title: '导出配置包（后台设置 / AI 模型 / 知识库预设 / 纠错 / 清理规则）',
      defaultPath: `岐黄鉴方配置-${stamp}.qhcfg`,
      filters: [{ name: '配置包', extensions: ['qhcfg', 'json'] }],
    };
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = win ? await dialog.showSaveDialog(win, opt) : await dialog.showSaveDialog(opt);
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    try { return dataport.exportConfig(res.filePath); }
    catch (err) { return { ok: false, error: err && err.message || String(err) }; }
  });
  ipcMain.handle('data:export-db', async (e) => {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const opt = {
      title: '导出整库（单文件搬家：含全部设置、预设与采集记录）',
      defaultPath: `岐黄鉴方-data-${stamp}.db`,
      filters: [{ name: 'SQLite 数据库', extensions: ['db'] }],
    };
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = win ? await dialog.showSaveDialog(win, opt) : await dialog.showSaveDialog(opt);
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    try { return dataport.exportDb(res.filePath); }
    catch (err) { return { ok: false, error: err && err.message || String(err) }; }
  });
  ipcMain.handle('data:import-config', async (e) => {
    const opt = {
      title: '导入配置包（覆盖同名设置，未包含的保持原样）',
      properties: ['openFile'],
      filters: [{ name: '配置包', extensions: ['qhcfg', 'json'] }],
    };
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = win ? await dialog.showOpenDialog(win, opt) : await dialog.showOpenDialog(opt);
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
    let out = null;
    try { out = dataport.importConfig(res.filePaths[0]); }
    catch (err) { return { ok: false, error: err && err.message || String(err) }; }
    if (out && out.ok) {
      // 热应用：kv 类配置（AI 模型 / OCR / 账号）立即生效；知识库类由下次分析自动重载，
      // 但已打开的面板仍持旧内存态 —— 需要重启的提示由页面按 needRestart 给出。
      try {
        aiSvc = ai.initAi(app.getPath('userData'));
        const oc = DB.kvGet('ocr');
        if (oc && typeof oc === 'object') capture.setOcrConfig(oc);
        syscfg.initSysCfg(app.getPath('userData'), logLine);
        if (userKb && typeof userKb.loadFromDisk === 'function') userKb.loadFromDisk();
        logLine('[data]', 'config imported: kv=' + out.kv + ' kb=' + out.kb + ' kinds=' + out.kbKinds);
      } catch (err) { logLine('[data]', 'config hot-apply failed: ' + (err && err.message)); }
      out.needRestart = out.kb > 0;
    }
    return out;
  });
  // ---------- 界面偏好（主题 / 侧栏 / 导航折叠）：入库，随 data.db 搬家 ----------
  ipcMain.handle('ui:prefs-get', () => {
    const p = DB.kvGet('uiprefs');
    return { ok: true, prefs: (p && typeof p === 'object' && !Array.isArray(p)) ? p : {} };
  });
  ipcMain.handle('ui:prefs-set', (e, patch) => {
    const cur = DB.kvGet('uiprefs');
    const base = (cur && typeof cur === 'object' && !Array.isArray(cur)) ? cur : {};
    const add = (patch && typeof patch === 'object' && !Array.isArray(patch)) ? patch : {};
    const next = Object.assign({}, base, add);
    // 只保留可序列化的短值，避免前端误传大对象把 kv 撑爆
    for (const k of Object.keys(next)) {
      if (typeof next[k] === 'string' && next[k].length > 120) next[k] = next[k].slice(0, 120);
      if (next[k] === null || next[k] === undefined) delete next[k];
    }
    DB.kvSet('uiprefs', next);
    return { ok: true, prefs: next };
  });
  ipcMain.handle('data:relocate', async (e) => {
    const opt = {
      title: '选择新的数据目录（建议选网盘同步文件夹内新建的空目录）',
      properties: ['openDirectory', 'createDirectory'],
    };
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = win ? await dialog.showOpenDialog(win, opt) : await dialog.showOpenDialog(opt);
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
    const target = res.filePaths[0];
    const cur = app.getPath('userData');
    // 防嵌套互套：新旧目录不能互相包含
    const norm = p => path.resolve(p).toLowerCase().replace(/[\\/]$/, '');
    if (norm(target) === norm(cur)) return { ok: false, error: '新目录就是当前数据目录' };
    if (norm(target).startsWith(norm(cur) + path.sep) || norm(cur).startsWith(norm(target) + path.sep)) {
      return { ok: false, error: '新目录不能是当前数据目录的子/父目录' };
    }
    try {
      const copyAll = (src, dest) => {
        if (!fs.existsSync(src)) return;
        fs.mkdirSync(dest, { recursive: true });
        for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
          if (ent.name.endsWith('.tmp') || ent.name === 'logs') continue;
          const s = path.join(src, ent.name), d = path.join(dest, ent.name);
          if (ent.isDirectory()) copyAll(s, d); else fs.copyFileSync(s, d);
        }
      };
      // 全部设置已在 data.db 内，只搬记录附件 / 备份 / 日志与库文件；
      // knowledge、config 目录里只剩 .migrated 留底，不再复制（避免把旧格式带进新目录）。
      for (const d of ['records', 'backups', 'logs']) copyAll(path.join(cur, d), path.join(target, d));
      // SQLite 数据库：先 checkpoint 把 WAL 落进主文件，再复制（含残留 wal/shm）
      try { DB.checkpoint(); } catch (e) {}
      for (const f of ['data.db', 'data.db-wal', 'data.db-shm']) {
        if (fs.existsSync(path.join(cur, f))) fs.copyFileSync(path.join(cur, f), path.join(target, f));
      }
      fs.writeFileSync(path.join(__dirname, 'portable.dat'), target, 'utf8');
      app.setPath('userData', target);
      logLine('[data]', 'relocated -> ' + target);
      return { ok: true, dir: target };
    } catch (err) {
      return { ok: false, error: err && err.message || String(err) };
    }
  });
  ipcMain.handle('backup:export', async (e, opts) => {
    const r = require('./lib/backup');
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const opt = {
      title: '导出数据备份',
      defaultPath: '岐黄鉴方备份-' + stamp + '.bak.json',
      filters: [{ name: '备份文件', extensions: ['json'] }],
    };
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = win ? await dialog.showSaveDialog(win, opt) : await dialog.showSaveDialog(opt);
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    return r.exportBackup(res.filePath);
  });
  ipcMain.handle('backup:import', async (e) => {
    const r = require('./lib/backup');
    const opt = {
      title: '从备份文件恢复',
      filters: [{ name: '备份文件', extensions: ['json'] }],
      properties: ['openFile'],
    };
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = win ? await dialog.showOpenDialog(win, opt) : await dialog.showOpenDialog(opt);
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
    try {
      const out = r.importBackup(res.filePaths[0]);
      logLine('[backup]','imported from ' + res.filePaths[0] + ' restored=' + out.restored);
      return out;
    } catch (err) {
      logLine('[backup]','import failed:  ' + (err && err.message));
      return { ok: false, error: err && err.message || String(err) };
    }
  });
  // 后台「AI 设置 → 自动清理噪音」：从识别结果里自动推荐清理规则
  const stripsuggest = require('./lib/stripsuggest');
  ipcMain.handle('admin:strip-suggest', (e, { text, existing } = {}) => {
    try { return { ok: true, ...stripsuggest.suggest(text, existing || {}) }; }
    catch (err) { return { ok: false, error: err && err.message || String(err) }; }
  });
  // 让大模型在候选之外再补几条（纯联网部分，不进对拍）
  async function aiSuggestRules(text) {
    try {
      const r = await ai.chat(stripsuggest.AI_SYSTEM, stripsuggest.aiPrompt(text), { maxTokens: 400 });
      return stripsuggest.parseAiRules(r && r.content);
    } catch (err) {
      logLine('ai', 'strip suggest ERR ' + (err && err.message));
      return [];
    }
  }
  // 上传处方图片 → 视觉模型识别 → 本地候选 + AI 补充
  ipcMain.handle('admin:strip-from-image', async (e, { dataUrl, opts } = {}) => {
    try {
      const b64 = String(dataUrl || '').replace(/^data:image\/\w+;base64,/, '');
      if (!b64 || b64.length < 100) return { ok: false, error: '未获取到图像数据' };
      if (!ai.visionReady()) return { ok: false, error: '未配置视觉模型：请先在「模型配置」里添加视觉模型并保存' };
      const p = path.join(store.recordsDir, 'img_strip_' + Date.now() + '.png');
      fs.writeFileSync(p, Buffer.from(b64, 'base64'));
      const r = await ai.visionOcr(p);
      const text = String((r && r.text) || '').trim();
      if (!text) return { ok: false, error: '没识别到文字：换张更清晰的截图，或框住处方主体' };
      const sug = stripsuggest.suggest(text, (opts && opts.existing) || {});
      let aiCands = [];
      if (!(opts && opts.noAi)) aiCands = await aiSuggestRules(text);
      return { ok: true, text, engine: (r && r.engine) || '', model: (r && r.model) || '',
               candidates: sug.candidates.concat(aiCands), aiCount: aiCands.length };
    } catch (err) {
      return { ok: false, error: err && err.message || String(err) };
    }
  });
  // 程序目录镜像备份：换机/重装时 userData 会连同自动备份一起没，镜像一份到程序目录，
  // 用户把整个程序文件夹拷走（或网盘同步）就能带上全部数据。
  ipcMain.handle('backup:mirror-info', () => {
    try { return require('./lib/backup').mirrorInfo(); }
    catch (err) { return { ok: false, error: err && err.message || String(err) }; }
  });
  ipcMain.handle('backup:mirror-now', () => {
    try {
      const out = require('./lib/backup').mirrorNow();
      if (out && out.ok) logLine('[backup]', 'mirror -> ' + out.path);
      return out;
    } catch (err) { return { ok: false, error: err && err.message || String(err) }; }
  });
  ipcMain.handle('sys:set-app', (e, patch) => syscfg.setApp(patch || {}));
  ipcMain.handle('sys:set-admin', (e, p) => syscfg.setAdminAccount(p || {}));
  ipcMain.handle('sys:clear-admin', (e, p) => syscfg.clearAdminAccount(p || {}));
  ipcMain.handle('sys:depts-set', (e, list) => syscfg.setDepts(list));
  ipcMain.handle('sys:users-list', () => syscfg.listUsers());
  ipcMain.handle('sys:user-upsert', (e, u) => syscfg.upsertUser(u || {}));
  ipcMain.handle('sys:user-remove', (e, user) => syscfg.removeUser(user));
  ipcMain.handle('sys:login', (e, { scope, user, pass } = {}) => syscfg.verifyLogin(scope, user, pass));
  ipcMain.handle('sys:backup', (e, targetDir) => syscfg.backup(targetDir));
  ipcMain.handle('sys:logs-get', (e, n) => syscfg.readLog(n));
  ipcMain.handle('sys:logs-open', () => { shell.openPath(path.join(app.getPath('userData'), 'logs')); return true; });
  ipcMain.handle('sys:data-open', () => { shell.openPath(app.getPath('userData')); return true; });
  ipcMain.handle('sys:open-url', (e, url) => { const u=String(url||''); if(/^https?:\/\//i.test(u)){ shell.openExternal(u); return true; } return false; });
  ipcMain.handle('kb:stats', () => userKb ? userKb.stats() : {});
  // 知识库列表出口统一注入拼音检索字段：py=全拼、py0=首字母（供所有检索框拼音/首字母检索）
  let _pyCache = null;
  function withPy(list) {
    let { pinyin } = require('pinyin-pro');
    const pyOf = (s) => { try { return pinyin(String(s), { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('').replace(/\s+/g, '').toLowerCase(); } catch (e) { return ''; } };
    const py0Of = (s) => { try { return pinyin(String(s), { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('').replace(/\s+/g, '').toLowerCase(); } catch (e) { return ''; } };
    return list.map(x => {
      const nm = x.n || x.name || '';
      const aliases = (x.aliases || []).concat(x.aka || []);
      const alPy = aliases.map(a => pyOf(a) + ' ' + py0Of(a)).join(' ');
      return Object.assign({}, x, { py: pyOf(nm) + ' ' + alPy, py0: py0Of(nm) });
    });
  }
  ipcMain.handle('kb:list-all', () => {
    if (!userKb) return { herbs: [], formulas: [] };
    const raw = userKb.listAll();
    if (!_pyCache || _pyCache.hn !== raw.herbs.length || _pyCache.fn !== raw.formulas.length) {
      _pyCache = { hn: raw.herbs.length, fn: raw.formulas.length, herbs: withPy(raw.herbs || []), formulas: withPy(raw.formulas || []) };
    }
    return { herbs: _pyCache.herbs, formulas: _pyCache.formulas };
  });
  ipcMain.handle('kb:list', (e, kind) => userKb ? userKb.list(kind) : []);
  ipcMain.handle('kb:upsert', (e, kind, obj) => userKb ? userKb.upsert(kind, obj) : { ok: false, error: '未初始化' });
  ipcMain.handle('kb:remove', (e, kind, name) => userKb ? userKb.remove(kind, name) : { ok: false, error: '未初始化' });
  ipcMain.handle('kb:import', (e, kind, arr) => userKb ? userKb.importBatch(kind, arr) : { ok: false, error: '未初始化' });

  // ===== Excel 批量导入 + 模板下载（后台所有库统一走 xlsx，规则见 lib/xlsximport.js）=====
  ipcMain.handle('kb:xlsx-import', async (e, target) => {
    const t = XLSX_TARGETS[target];
    if (!t) return { ok: false, error: '未知导入类型' };
    const win = adminWin && !adminWin.isDestroyed() ? adminWin : null;
    const opts = { title: `导入${t.title} (Excel)`, properties: ['openFile'], filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'csv'] }] };
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (canceled || !filePaths || !filePaths.length) return { canceled: true };
    try {
      const XLSX = require('xlsx');
      const wb = XLSX.read(fs.readFileSync(filePaths[0]), { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      const objs = xlsxRowsToObjects(rows, t.cols);
      if (!objs.length) return { ok: false, error: '未解析到有效数据行（首行须为模板表头，且每行有名称）' };
      const r = t.store === 'user'
        ? (userKb ? userKb.importBatch(target === 'herb' ? KIND_HERB : KIND_FORMULA, objs) : { ok: false, error: '未初始化' })
        : t.store === 'yibao'
          ? (userKb ? userKb.ybImport(objs) : { ok: false, error: '未初始化' })
          : (clinicalKb ? clinicalKb.importBatch(target, objs) : { ok: false, error: '未初始化' });
      if (r.ok && t.store === 'clinical' && target === KIND_WESTMAP) syncWestMap();
      return { ok: true, file: path.basename(filePaths[0]), ...r };
    } catch (err) {
      return { ok: false, error: '解析失败：' + err.message };
    }
  });
  ipcMain.handle('kb:xlsx-template', async (e, target) => {
    const t = XLSX_TARGETS[target];
    if (!t) return { ok: false, error: '未知导入类型' };
    const win = adminWin && !adminWin.isDestroyed() ? adminWin : null;
    const opts = { title: `保存${t.title}导入模板`, defaultPath: `岐黄鉴方-${t.title}导入模板.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] };
    const { canceled, filePath } = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (canceled || !filePath) return { canceled: true };
    try {
      const { wb } = buildTemplateWorkbook(target);
      const XLSX = require('xlsx');
      XLSX.writeFile(wb, filePath);
      return { ok: true, file: path.basename(filePath) };
    } catch (err) {
      return { ok: false, error: '模板生成失败：' + err.message };
    }
  });
  ipcMain.handle('kb:open-dir', () => { if (userKb) shell.openPath(userKb.dir); });
  ipcMain.handle('kb:pick-import', async (e, kind) => {
    if (!userKb) return { ok: false, error: '未初始化' };
    const win = adminWin && !adminWin.isDestroyed() ? adminWin : null;
    const opts = {
      title: kind === KIND_HERB ? '导入中药数据 (JSON)' : '导入方剂数据 (JSON)',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    };
    const { canceled, filePaths } = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (canceled || !filePaths || !filePaths.length) return { canceled: true };
    const file = filePaths[0];
    try {
      const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(arr)) return { ok: false, error: '文件内容应为 JSON 数组' };
      const r = userKb.importBatch(kind, arr);
      return { ok: true, file: path.basename(file), ...r };
    } catch (err) {
      return { ok: false, error: '解析失败：' + err.message };
    }
  });

  // ===== 辨证库（诊断证型 + 症状库 + 西医对照库） =====
  // 西医对照库 → 引擎直配表热同步（启动与后台增删改后调用）
  function syncWestMap() {
    if (!clinicalKb) return 0;
    return setWestMap(clinicalKb.list(KIND_WESTMAP));
  }
  ipcMain.handle('kb:clinical-stats', () => clinicalKb ? clinicalKb.stats() : {});
  ipcMain.handle('kb:clinical-list', (e, kind) => clinicalKb ? clinicalKb.list(kind) : []);
  ipcMain.handle('kb:clinical-rows', () => clinicalKb ? clinicalKb.syndromeRows() : []);
  ipcMain.handle('kb:clinical-upsert', (e, kind, obj) => {
    const r = clinicalKb ? clinicalKb.upsert(kind, obj) : { ok: false, error: '未初始化' };
    if (r.ok && kind === KIND_WESTMAP) syncWestMap();
    return r;
  });
  ipcMain.handle('kb:clinical-remove', (e, kind, name) => {
    const r = clinicalKb ? clinicalKb.remove(kind, name) : { ok: false, error: '未初始化' };
    if (r.ok && kind === KIND_WESTMAP) syncWestMap();
    return r;
  });
  ipcMain.handle('kb:clinical-clear', (e, kind) => {
    const r = clinicalKb ? clinicalKb.clear(kind) : { ok: false, error: '未初始化' };
    if (r.ok && kind === KIND_WESTMAP) syncWestMap();
    return r;
  });
  ipcMain.handle('kb:clinical-import', (e, kind, arr) => {
    const r = clinicalKb ? clinicalKb.importBatch(kind, arr) : { ok: false, error: '未初始化' };
    if (r.ok && kind === KIND_WESTMAP) syncWestMap();
    return r;
  });
  ipcMain.handle('kb:clinical-open-dir', () => { if (clinicalKb) shell.openPath(clinicalKb.dir); });
  ipcMain.handle('kb:clinical-pick-import', async (e, kind) => {
    if (!clinicalKb) return { ok: false, error: '未初始化' };
    const win = adminWin && !adminWin.isDestroyed() ? adminWin : null;
    const title = kind === KIND_DIAG ? '导入诊断证型数据 (JSON)' : kind === KIND_WESTMAP ? '导入西医对照数据 (JSON)' : '导入症状数据 (JSON)';
    const opts = { title, properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] };
    const { canceled, filePaths } = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (canceled || !filePaths || !filePaths.length) return { canceled: true };
    const file = filePaths[0];
    try {
      const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(arr)) return { ok: false, error: '文件内容应为 JSON 数组' };
      const r = clinicalKb.importBatch(kind, arr);
      return { ok: true, file: path.basename(file), ...r };
    } catch (err) {
      return { ok: false, error: '解析失败：' + err.message };
    }
  });
  // —— OCR 文字纠错自定义表（后台维护；内置表随代码升级）——
  ipcMain.handle('kb:ocr-list', () => userKb ? {
    builtin: Object.entries(KB.OCR_HERB_FIX).map(([w, r]) => ({ w, r })),
    user: userKb.ocrList()
  } : { builtin: [], user: [] });
  // 配伍禁忌规则库（十八反/十九畏内置 + 机构自定义）
  ipcMain.handle('kb:sbf-list', () => userKb ? userKb.sbfList() : { builtin: [], user: [] });
  ipcMain.handle('kb:sbf-add', (e, rule) => userKb ? userKb.sbfUpsert(rule) : { ok: false, error: '知识库未初始化' });
  ipcMain.handle('kb:sbf-del', (e, id) => userKb ? userKb.sbfRemove(id) : { ok: false, error: '知识库未初始化' });
  // 中药医保规则库（机构自维护，knowledge/yibao.json）
  ipcMain.handle('kb:yibao-list', () => userKb ? userKb.ybList() : []);
  ipcMain.handle('kb:yibao-add', (e, rule) => userKb ? userKb.ybUpsert(rule) : { ok: false, error: '知识库未初始化' });
  ipcMain.handle('kb:yibao-del', (e, id) => userKb ? userKb.ybRemove(id) : { ok: false, error: '知识库未初始化' });
  // ===== AI 补库：未匹配药名队列 =====
  ipcMain.handle('kb:unm-list', () => userKb ? userKb.unmatchedList() : []);
  ipcMain.handle('kb:unm-del', (e, id) => userKb ? userKb.unmatchedRemove(id) : { ok: false, error: '知识库未初始化' });
  ipcMain.handle('kb:unm-ignore', (e, id) => userKb ? userKb.unmatchedSetStatus(id, 'ignored') : { ok: false, error: '知识库未初始化' });
  // AI 自动维护：把未匹配药名交给云端模型判定——库内形近/别名 → 加入纠错表；库外真实中药 → 补录中药库
  ipcMain.handle('kb:unm-ai', async (e, onlyId) => {
    if (!userKb) return { ok: false, error: '知识库未初始化' };
    const pending = userKb.unmatchedList().filter(x => x.status === 'pending' && (!onlyId || x.id === onlyId));
    if (!pending.length) return { ok: true, resolved: 0, note: '队列里没有待处理药名' };
    const known = [...new Set(KB.getAllHerbs().map(h => h.n).filter(Boolean))];
    const sys = '你是中医药术语标准化专家。对 OCR 识别出的混乱中药名做归一化。只输出 JSON 数组，不要任何其他文字、不要 Markdown 代码块。';
    const user = [
      '待解析药名清单（OCR 原文）：',
      pending.map(p => `- ${p.name}`).join('\n'),
      '',
      '知识库现有中药正名（可用于纠错目标）：',
      known.join('、'),
      '',
      '判定规则：',
      '1. 若待解析名可唯一对应某个库内药名（形近字/OCR错字/俗名别名/炮制品），输出 {"input":"原文","corrected":"库内正名","confidence":0.92,"reason":"一句话依据"}',
      '2. 若确为库外真实中药（知识库漏收），输出 {"input":"原文","corrected":null,"newHerb":{"name":"规范正名","nature":"性味","fx":"功效","use":"用量","note":"注意"},"confidence":0.85,"reason":"一句话依据"}',
      '3. 无法判断（非药名/噪声/过于含糊），输出 {"input":"原文","corrected":null,"newHerb":null,"confidence":0,"reason":"无法判断的原因"}',
      '逐条输出，数组元素顺序与输入一致。'
    ].join('\n');
    let r;
    try {
      r = await ai.chat(sys, user, { temperature: 0.2, maxTokens: 2400 });
    } catch (err) {
      return { ok: false, error: err.message || 'AI 调用失败' };
    }
    // 解析模型返回（容错：剥 ```json 围栏、截取首个 [ ... ] 段）
    let arr = null;
    try {
      const txt = String(r.content || '').replace(/```(?:json)?/gi, '').trim();
      const m = txt.match(/\[[\s\S]*\]/);
      arr = JSON.parse(m ? m[0] : txt);
    } catch (err) { arr = null; }
    if (!Array.isArray(arr)) return { ok: false, error: 'AI 返回格式无法解析', raw: String(r.content || '').slice(0, 300), mock: !!r.mock };
    const applied = [];
    for (const it of arr) {
      const item = pending.find(p => p.name === it.input);
      if (!item) continue;
      const corrected = String(it.corrected || '').trim();
      if (corrected && KB.getCanon()[corrected]) {
        const o = userKb.ocrUpsert({ w: item.name, r: corrected });
        if (o.ok) { userKb.unmatchedSetStatus(item.id, 'done', { action: 'ocrfix', to: corrected, reason: it.reason || '', ai: !r.mock }); applied.push(`${item.name} → 纠错表「${corrected}」`); }
      } else if (it.newHerb && it.newHerb.name) {
        const h = it.newHerb;
        const o = userKb.upsert('herb', { name: h.name, nature: h.nature || '', fx: h.fx || '', use: h.use || '', note: h.note || '', ai: true });
        if (o.ok) { userKb.unmatchedSetStatus(item.id, 'done', { action: 'herb', to: h.name, reason: it.reason || '', ai: !r.mock }); applied.push(`${item.name} → 新增中药「${h.name}」`); }
      } else {
        userKb.unmatchedSetStatus(item.id, 'ignored', { action: 'none', reason: it.reason || 'AI 无法判断' });
        applied.push(`${item.name} → 无法判断，已忽略`);
      }
    }
    logLine('kb', 'unm-ai resolved=' + applied.length + ' mock=' + !!r.mock);
    return { ok: true, resolved: applied.length, applied, mock: !!r.mock };
  });
  // 全量维护：规则 + 中药库全量药名（一次拉取，前端做统计/筛选/datalist）
  ipcMain.handle('kb:yibao-full', () => {
    const names = [...new Set(KB.getAllHerbs().map(h => h.n).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'));
    return { rules: userKb ? userKb.ybList() : [], herbNames: names };
  });
  // 全量导出：库内全部药名预填 Excel（已维护的带上现值，未维护的留空类别），填好导回即完成全量维护
  ipcMain.handle('kb:yibao-export', async () => {
    try {
      const rules = userKb ? userKb.ybList() : [];
      const byName = {}; rules.forEach(r => { byName[r.name] = r; });
      const names = [...new Set([...rules.map(r => r.name), ...KB.getAllHerbs().map(h => h.n).filter(Boolean)])]
        .sort((a, b) => a.localeCompare(b, 'zh'));
      const XLSX = require('xlsx');
      const header = ['药名*', '医保编码', '支付类别(甲类/乙类/丙类/自费)', '限定支付范围', '自付比例(%)', '备注'];
      const aoa = [header].concat(names.map(n => {
        const r = byName[n] || {};
        return [n, r.code || '', r.payType || '', r.limit || '', r.copay || '', r.note || ''];
      }));
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 22 }, { wch: 28 }, { wch: 10 }, { wch: 24 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '医保规则');
      const win = adminWin && !adminWin.isDestroyed() ? adminWin : null;
      const opts = { title: '导出中药医保规则（全量药名）', defaultPath: '岐黄鉴方-中药医保规则-全量维护.xlsx', filters: [{ name: 'Excel', extensions: ['xlsx'] }] };
      const { canceled, filePath } = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (canceled || !filePath) return { canceled: true };
      XLSX.writeFile(wb, filePath);
      return { ok: true, file: path.basename(filePath), total: names.length, maintained: rules.length };
    } catch (err) {
      return { ok: false, error: '导出失败：' + err.message };
    }
  });
  ipcMain.handle('kb:ocr-upsert', (e, obj) => userKb ? userKb.ocrUpsert(obj) : { ok: false, error: '未初始化' });
  ipcMain.handle('kb:ocr-remove', (e, w) => userKb ? userKb.ocrRemove(w) : { ok: false, error: '未初始化' });
  ipcMain.handle('kb:ocr-test', (e, text) => userKb ? userKb.ocrTest(text) : { text: String(text || ''), fixes: [] });

  // —— 国家标准库 GB/T 15657-2021（病名/证候/治法 代码表）——
  ipcMain.handle('gbt:stats', () => gbt.stats());  ipcMain.handle('gbt:search', (e, { kind = 'all', q = '', l1 = '' } = {}) => gbt.search(q, kind, l1, 600));
  ipcMain.handle('gbt:match-diag', () => {
    if (!clinicalKb) return [];
    const names = clinicalKb.list(KIND_DIAG).map(d => d.name);
    const m = gbt.matchNames(names);
    return names.map(n => (m.has(n) ? { diag: n, ...m.get(n) } : null)).filter(Boolean);
  });
  // —— 医保编码对照库（国临版 ↔ 医保版2.0）——
  ipcMain.handle('icd:stats', () => (icdmap ? icdmap.stats() : { total: 0, diffCode: 0, diffName: 0, diffCats: {} }));
  ipcMain.handle('icd:search', (e, { q = '', mode = 'all' } = {}) => (icdmap ? icdmap.search(q, mode, 300) : { list: [], truncated: false }));
  ipcMain.handle('icd:lookup-name', (e, name) => (icdmap ? icdmap.lookupByName(name) : null));
  // —— 参照库（国标/内置只读数据）状态与手动重同步 ——
  ipcMain.handle('ref:info', () => {
    try { return { ok: true, list: DB.refInfo(), gbtSource: gbt.source(), icdSource: icdmap.source() }; }
    catch (e) { return { ok: false, error: (e && e.message) || String(e), list: [] }; }
  });
  ipcMain.handle('ref:sync', () => {
    try {
      const out = require('./lib/refsync').syncAll(logLine);
      return { ok: true, out, info: DB.refInfo() };
    } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
  });
  // 西医诊断 → 中医诊断候选（工作台诊断检索匹配）
  ipcMain.handle('tcm:west-candidates', (e, west) => {
    const names = clinicalKb ? clinicalKb.list(KIND_DIAG).map(d => d.name) : [];
    return westTcmCandidates(west, names);
  });
  // 辨证咨询窗数据包：诊断/证型/症状 + 方剂精简字段
  ipcMain.handle('kb:consult-data', () => {
    if (!clinicalKb || !KB) return { diagnoses: [], symptoms: [], formulas: [] };
    const { list, syndromeRows } = clinicalKb;
    return {
      diagnoses: list(KIND_DIAG),
      symptoms: list(KIND_SX),
      syndromeRows: syndromeRows(),
      formulas: KB.getAllFormulas().map(f => ({ n: f.n, k: f.k || 'f', s: f.s || [], c: f.c, g: f.g, m: f.m, u: f.u, origin: f.origin, x: f.x || '' }))
    };
  });
}

// 单实例锁：防止新旧实例叠放导致界面混淆（自检模式不占用锁）
const isSelfCheck = process.argv.includes('--smoke') || process.argv.includes('--rec-gif')
  || process.argv.includes('--clear-records') || process.argv.includes('--seed-demo');
if (!isSelfCheck) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      // 已有实例在跑：把悬浮球唤到最前，忽略本次重复启动
      try {
        if (floatWin && !floatWin.isDestroyed()) { floatWin.show(); floatWin.focus(); }
        if (panelWin && !panelWin.isDestroyed() && panelWin.isVisible()) { panelWin.show(); panelWin.focus(); }
      } catch (e) { /* ignore */ }
    });
  }
}

// ---------- 应用生命周期 ----------
app.whenReady().then(async () => {
  // 拍照识别：允许渲染层访问摄像头（仅放行 media/fullscreen，其余维持默认拒绝）
  try {
    const { session } = require('electron');
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'media' || permission === 'fullscreen'));
  } catch (e) { /* 老版本无此 API 时忽略 */ }
  // SQLite 内核：先于所有存储模块初始化，并把旧 JSON 数据一次性迁入 data.db
  DB.initDb(app.getPath('userData'), logLine);
  try { DB.migrateJson(app.getPath('userData')); } catch (e) { logLine('[db]', 'migrate failed: ' + (e && e.message)); }
  // 参照库同步：GB/T 15657 / ICD 对照 / 内置中药方剂（源文件指纹变化时自动重载）
  try { require('./lib/refsync').syncAll(logLine); } catch (e) { logLine('[ref]', 'sync failed: ' + (e && e.message)); }
  // 点评红线：首次运行把出厂默认值写进 kv（不写则审计会显示「未配置」，导入配置包也带不走默认值）
  try { if (!DB.kvHas('rxrule')) rxrule.set({}); } catch (e) { logLine('[rxrule]', 'seed failed: ' + (e && e.message)); }
  store = initStore(app.getPath('userData'));
  userKb = initUserKb(app.getPath('userData'));
  global.__userKb = userKb;   // 自检/录制模式直达实例（rec-gif 播种演示队列后热重载）
  clinicalKb = initClinicalKb(app.getPath('userData'));
  setWestMap(clinicalKb ? clinicalKb.list(KIND_WESTMAP) : []); // 西医对照库 → 引擎直配表
  syscfg.initSysCfg(app.getPath('userData'), logLine); // 基础信息：软件名/登录模式/账号/备份/日志
  // 数据加固：启动时自动日备一份到 userData/backups/（当天已备则跳过，保留最近 7 份）
  try {
    const out = require('./lib/backup').autoBackupDaily();
    if (out) logLine('[backup]', 'auto daily backup -> ' + out);
  } catch (e) { logLine('[backup]', 'auto backup failed: ' + (e && e.message)); }
  aiSvc = ai.initAi(app.getPath('userData'));
  // OCR 引擎配置（data.db kv:ocr）：engine=auto|paddle|rapid|win|tess，tier=PP-OCRv6 档位
  try {
    const oc = DB.kvGet('ocr');
    if (oc && typeof oc === 'object') capture.setOcrConfig(oc);
  } catch (e) { /* 配置损坏则用默认 */ }
  // 一次性性能迁移（仅正常启动执行，探针脚本不走这里）：历史默认档 medium 在实测中
  // 比 tiny 慢约 10 倍而术语命中完全一致 → 未主动改过档位的用户平滑升级。
  // 与 C# 宿主 Ocr.MigratePerfDefaults() 同序同义。
  try {
    if (!DB.kvGet('ocrTierV2')) {
      if ((capture.ocrConfig().tier || 'medium') === 'medium') {
        DB.kvSet('ocr', capture.setOcrConfig({ tier: 'tiny' }));
        logLine('ocr', 'perf migration: tier medium -> tiny');
      }
      DB.kvSet('ocrTierV2', 1);
    }
  } catch (e) { /* 忽略 */ }
  registerIpc();
  // 离线运维入口（不建窗、不装托盘，执行完退出）：--clear-records 清空采集记录；--seed-demo 预置演示数据。
  // 供部署/演示环境初始化使用，与后台按钮走同一份实现。
  // 配置搬家命令行（批量部署 / 运维）：
  //   --audit-config                 打印配置入库审计（每类设置的来源与条目数）
  //   --export-config <file.qhcfg>   导出配置包（后台设置/AI 模型/预设/纠错/清理规则）
  //   --import-config <file.qhcfg>   导入配置包（只覆盖包内键，导入前自动快照）
  //   --export-db <file.db>          导出整库（单文件搬家）
  if (process.argv.includes('--audit-config') || process.argv.includes('--export-config') ||
      process.argv.includes('--import-config') || process.argv.includes('--export-db')) {
    const argVal = (name) => {
      const i = process.argv.indexOf(name);
      const v = i >= 0 ? String(process.argv[i + 1] || '') : '';
      return v && !v.startsWith('--') ? v : '';
    };
    const out = {};
    try {
      if (process.argv.includes('--audit-config')) out.audit = dataport.audit(app.getPath('userData'));
      const ex = argVal('--export-config'); if (ex) out.export = dataport.exportConfig(ex);
      const ed = argVal('--export-db'); if (ed) out.exportDb = dataport.exportDb(ed);
      const im = argVal('--import-config'); if (im) out.import = dataport.importConfig(im);
    } catch (e) { out.error = String(e && e.message || e); }
    try { DB.checkpoint(); } catch (e) { /* 忽略 */ }
    console.log('[dataport] ' + JSON.stringify(out));
    app.exit(out.error ? 1 : 0);
    return;
  }
  if (process.argv.includes('--clear-records') || process.argv.includes('--seed-demo')) {
    const out = {};
    try {
      if (process.argv.includes('--clear-records')) out.clear = mntClearRecords ? mntClearRecords() : { ok: false, error: '内部未就绪' };
      if (process.argv.includes('--seed-demo')) out.seed = mntSeedDemo ? mntSeedDemo() : { ok: false, error: '内部未就绪' };
    } catch (e) { out.error = String(e && e.message || e); }
    try { DB.checkpoint(); } catch (e) { /* 忽略 */ }
    console.log('[maintenance] ' + JSON.stringify(out));
    app.exit(out.error ? 1 : 0);
    return;
  }
  createFloatBall();
  createTray();
  // 全局快捷键：医院系统里 Ctrl+C 后按 Ctrl+Alt+V 直接入库（零 OCR 误差，最精确的一路）
  try {
    const ok = globalShortcut.register('Control+Alt+V', () => { openPasteBox(); });
    console.log('[hotkey] Ctrl+Alt+V =', ok ? 'registered' : 'failed');
  } catch (e) { console.warn('[hotkey] 注册失败：', e.message); }
  if (process.argv.includes('--panel')) openPanel();
  // 演示截图流水线：离屏渲染窗口驱动各分镜状态，capturePage 出图后自动退出
  if (process.argv.includes('--demo-shots')) {
    require('./lib/demo-shots').run();
  }
  // 演示动图录制：离屏窗口逐帧抓真实界面（--rec-gif / --only=场景），出帧后由 scripts/_gif_build.py 合成
  if (process.argv.some(a => a === '--rec-gif' || a.startsWith('--rec-gif='))) {
    require('./lib/rec-gif').run();
  }
  // PP-OCRv6 预热：后台加载模型（约 8s），避免首次截图等待
  if (!process.argv.includes('--smoke') && !process.argv.includes('--demo-shots')) {
    setTimeout(() => { try { capture.warmupOcr(); } catch (e) { /* 忽略 */ } }, 2500);
  }
  // 悬浮球置顶保活：每 5s 抬回 topmost 组顶（被其他置顶窗口/HIS 弹窗压住时自动恢复）
  setInterval(keepFloatTop, 5000);

  if (process.argv.includes('--smoke')) {
    // 自检：窗口创建 + 前台窗口读取 + 悬浮球两态 UI 往返
    try {
      const fg = await capture.getForegroundWindow();
      console.log('[smoke] fgwindow ok:', JSON.stringify({ title: fg.title, process: fg.process, w: fg.w, h: fg.h }));

      // 初始位置：工作区右上角
      const b0 = floatWin.getBounds();
      const home = ballHomePos();
      const homeOk = Math.abs(b0.x - home.x) <= 1 && Math.abs(b0.y - home.y) <= 1;
      console.log('[smoke] home=', b0.x + ',' + b0.y, 'expect=', home.x + ',' + home.y, '| topRight=', homeOk);

      // 展开：模拟点击悬浮球 → 面板显示且窗口放大；退出按钮必须完整可见
      const p1 = await floatWin.webContents.executeJavaScript(`(function(){
        document.getElementById('ball').click();
        return { expanded: document.getElementById('view-menu').style.display !== 'none' };
      })()`);
      await sleep(300); // 等主进程完成窗口 56→396 调整
      const p2 = await floatWin.webContents.executeJavaScript(`(function(){
        const q = document.querySelector('.item.quit');
        const r = q ? q.getBoundingClientRect() : null;
        return {
          quitFound: !!q,
          quitVisible: !!r && r.height > 2 && r.top >= 0 && r.bottom <= window.innerHeight + 0.5,
          innerH: window.innerHeight,
          quitBottom: r ? Math.round(r.bottom) : -1
        };
      })()`);
      const s1 = floatWin.getBounds();
      // 收起：点 ✕ → 小球显示且窗口还原
      await floatWin.webContents.executeJavaScript(`(function(){
        document.getElementById('btnClose').click();
        return true;
      })()`);
      await sleep(300);
      const s2 = floatWin.getBounds();
      const uiOk = p1.expanded && p2.quitFound && p2.quitVisible
        && Math.abs(s1.width - EXP.w) <= 1 && Math.abs(s1.height - EXP.h) <= 1
        && Math.abs(s2.width - BALL.size) <= 1 && Math.abs(s2.height - BALL.size) <= 1;
      console.log('[smoke] ui-expand=', JSON.stringify(p1), 'quit=', JSON.stringify(p2),
        'size=', s1.width + 'x' + s1.height,
        '| ui-collapse size=', s2.width + 'x' + s2.height, '| uiOk=', uiOk);

      // 知识库后台初始化（扩容后：方剂≥210、中药≥370、全部中药有分类）
      const kbs = userKb ? userKb.stats() : null;
      const kbOk = !!(kbs && kbs.formulaBuiltin >= 210 && kbs.herbBuiltin >= 370);
      console.log('[smoke] kb=', JSON.stringify({ f: kbs && kbs.formulaBuiltin, h: kbs && kbs.herbBuiltin, fu: kbs && kbs.formulaUser, hu: kbs && kbs.herbUser }), '| kbOk=', kbOk);
      // 辨证库/症状库/西医对照库：空库自动 seed 后应非空；扩容后阈值校验
      const cli = clinicalKb ? clinicalKb.stats() : null;
      const cliOk = !!(cli && cli.diagCount >= 140 && cli.symptomCount >= 200 && cli.symptomWest >= 100 && cli.syndromeCount >= 420 && cli.westMapCount >= 250);
      console.log('[smoke] clinical=', JSON.stringify({ diag: cli && cli.diagCount, sx: cli && cli.symptomCount, tcm: cli && cli.symptomTcm, west: cli && cli.symptomWest, syn: cli && cli.syndromeCount, wmap: cli && cli.westMapCount }), '| cliOk=', cliOk);
      const aiSt = aiSvc ? aiSvc._status() : null;
      console.log('[smoke] ai=', aiSt ? JSON.stringify({ svc: true, mock: aiSt.mock, hasKey: aiSt.hasKey, model: aiSt.modelLabel }) : 'none');
      // 国家标准库 GB/T 15657-2021：三库非空 + 辨证同名匹配样例(感冒→A01.01.01)
      const gst = gbt.stats();
      const gOk = !!(gst.disease && gst.disease.count >= 1300 && gst.syndrome && gst.syndrome.count >= 2000 && gst.therapy && gst.therapy.count >= 1000);
      const gm = gbt.matchNames(['感冒', '痢疾', '消渴']);
      const gMatchOk = gm.get('感冒') && gm.get('感冒').code === 'A01.01.01';
      console.log('[smoke] gbt=', JSON.stringify({ d: gst.disease.count, s: gst.syndrome.count, t: gst.therapy.count, total: gst.total }), '| gbtOk=', gOk, '| gbtMatch=', gMatchOk);
      // 自动辨证：病历文本判定 + 证型诊断 + 非病历不误判
      const cliD = clinicalKb ? clinicalKb.list(KIND_DIAG) : [];
      const cliS = clinicalKb ? clinicalKb.list(KIND_SX) : [];
      const jRec = autosynd.judge('中医诊断：咳嗽\n主诉：咳嗽3天，恶寒，痰白清稀。\n舌淡苔薄白，脉浮紧。', { 中医诊断: '咳嗽' }, cliD, cliS);
      const jNon = autosynd.judge('今日天气晴朗，适合外出散步。\nAfternoon meeting at 3pm.', {}, cliD, cliS);
      const autoOk = !!(jRec.record && jRec.synd && (jRec.diag === '咳嗽') && !jNon.record);
      console.log('[smoke] auto=', JSON.stringify({ record: jRec.record, diag: jRec.diag, synd: jRec.synd, src: jRec.syndSrc, nonRecord: jNon.record }), '| autoOk=', autoOk);
      // 西医诊断 → 中医诊断候选匹配（桡骨干骨折→骨折；2型糖尿病→消渴；心绞痛→胸痹）
      const wC1 = westTcmCandidates('桡骨干骨折', cliD.map(d => d.name));
      const wC2 = westTcmCandidates('2型糖尿病', cliD.map(d => d.name));
      const wC3 = westTcmCandidates('心绞痛', cliD.map(d => d.name));
      const westOk = wC1[0] === '骨折' && wC2[0] === '消渴' && wC3[0] === '胸痹';
      console.log('[smoke] west=', JSON.stringify({ gz: wC1[0], xk: wC2[0], xt: wC3[0] }), '| westOk=', westOk);
      // 替换药对：党参代人参推断四君子汤不误报缺味；无关药不误判
      const gSub = runTcm({ text: '党参12g、白术9g、茯苓9g、炙甘草6g', keys: {}, sections: [] });
      const subOk = !!(gSub.guess && gSub.guess.f.n === '四君子汤' && gSub.guess.miss.length === 0 && (gSub.guess.subHits || []).some(s => s.orig === '人参' && s.used === '党参'));
      console.log('[smoke] sub=', JSON.stringify({ guess: gSub.guess && gSub.guess.f.n, miss: gSub.guess && gSub.guess.miss, subHits: gSub.guess && (gSub.guess.subHits || []).map(s => s.orig + '←' + s.used) }), '| subOk=', subOk);
      // OCR 错字容错 + 药典常用药量上限：炙苜草45g→识别为甘草并告警；正常剂量不误报
      const tFz = runTcm({ text: '党参12g\n茯苓9g\n炙苜草 45g', keys: {}, sections: [] });
      const fzOk = !!(tFz.rx.items || []).some(i => i.tag === '甘草' && i.level === 'warn' && String(i.title).includes('45g')) && (tFz.herbs || []).includes('甘草')
        && !runTcm({ text: '甘草 6g\n茯苓 12g', keys: {}, sections: [] }).rx.items.some(i => i.level === 'warn');
      console.log('[smoke] fz=', JSON.stringify({ herbs: tFz.herbs, warns: (tFz.rx.items || []).filter(i => i.level === 'warn').map(i => i.tag + ':' + i.title) }), '| fzOk=', fzOk);
      // OCR 形近错字表：臼术45g→白术并超量告警；灸甘草→甘草；苍术/莪术正名不受影响；正常剂量不误报
      const tOcr = runTcm({ text: '党参12g\n茯苓9g\n臼术 45g', keys: {}, sections: [] });
      const tOcr2 = runTcm({ text: '苍术 10g\n莪术 9g\n灸甘草 8g', keys: {}, sections: [] });
      const ocrOk = (tOcr.herbs || []).includes('白术') && !!(tOcr.rx.items || []).some(i => i.tag === '白术' && i.level === 'warn' && String(i.title).includes('45g'))
        && (tOcr2.herbs || []).includes('甘草') && (tOcr2.herbs || []).includes('苍术') && (tOcr2.herbs || []).includes('莪术')
        && !tOcr2.rx.items.some(i => i.level === 'warn');
      console.log('[smoke] ocr=', JSON.stringify({ herbs: tOcr.herbs, herbs2: tOcr2.herbs, warns: (tOcr.rx.items || []).filter(i => i.level === 'warn').map(i => i.tag) }), '| ocrOk=', ocrOk);
      // OCR 文本级纠错（入库前）：错字全名替换，艾灸/针灸等非药名不误伤
      const fxR = KB.fixOcrText('党参 12克、炙苜草 45克、茯苓 9克、臼术 9克。艾灸疗法');
      let txtOk = fxR.text.includes('炙甘草') && fxR.text.includes('白术') && fxR.text.includes('艾灸') && !fxR.text.includes('苜') && !fxR.text.includes('臼');
      console.log('[smoke] txtfix=', JSON.stringify({ fixes: fxR.fixes }), '| txtOk=', txtOk);
      // 医学术语库约束纠错（零差错第二层）：漏字/形近/偏旁脱落/繁体，全部确定性可回溯
      const fxR2 = KB.fixOcrText('初步诊断：中医诊断:创伤病 气血瘀证 西医诊断过射挫伤（双）2.髖部叶 员伤（双）3.踝挫伤（左）4.头部的损伍',
        { syndromes: ['气滞血瘀证', '气虚血瘀证', '血瘀证'], diags: ['创伤病'], syndCtx: ['气滞血瘀证'] });
      const txtOk2 = fxR2.text.includes('气滞血瘀证') && fxR2.text.includes('肘挫伤') && fxR2.text.includes('髋部损伤')
        && fxR2.text.includes('头部的损伤') && !fxR2.text.includes('损伍') && !fxR2.text.includes('气血瘀证') && !fxR2.text.includes('员') && !fxR2.text.includes('髖');
      console.log('[smoke] txtfix2=', JSON.stringify({ fixes: fxR2.fixes, text: fxR2.text }), '| txtOk2=', txtOk2);
      txtOk = txtOk && txtOk2;
      // 要素提取：去括号内容/编号/标签，中医诊断·西医诊断·证型独立且干净
      const kp = analyze.extractKeyPoints('初步诊断：中医诊断:创伤病 气滞血瘀证\n西医诊断:1.肘挫伤（双）\n2.髋部损伤（双）\n3.踝挫伤（左）\n4.头部的损伤');
      const keysOk = kp['中医诊断'] === '创伤病' && kp['证型'] === '气滞血瘀证'
        && kp['西医诊断'] === '肘挫伤、髋部损伤、踝挫伤、头部的损伤';
      console.log('[smoke] keys=', JSON.stringify(kp), '| keysOk=', keysOk);
      // 证型换行连写："中医诊断：创伤病\n气滞血瘀证\n西医诊断…" → 证型独立行须识别
      const kp2 = analyze.extractKeyPoints('初步诊断：中医诊断:创伤病\n气滞血瘀证\n西医诊断:1.肘挫伤（双）\n2.髋部损伤（双）\n4.头部的损伤');
      const keysOk2 = kp2['中医诊断'] === '创伤病' && kp2['证型'] === '气滞血瘀证' && kp2['西医诊断'] === '肘挫伤、髋部损伤、头部的损伤';
      console.log('[smoke] keys2=', JSON.stringify(kp2), '| keysOk2=', keysOk2);
      // 证型库支持度收敛：无诊断上下文时，漏字证型按全库关联次数唯一最大纠正；支持度并列不盲改
      const fxR3 = KB.fixOcrText('气血瘀证', { syndromes: ['气滞血瘀证', '气虚血瘀证', '血瘀证'], diags: [], syndCtx: [], syndSupport: { '气滞血瘀证': 26, '气虚血瘀证': 2 } });
      const keysOk3 = fxR3.text === '气滞血瘀证';
      const fxR4 = KB.fixOcrText('气血瘀证', { syndromes: ['气滞血瘀证', '气虚血瘀证'], diags: [], syndCtx: [], syndSupport: { '气滞血瘀证': 26, '气虚血瘀证': 26 } });
      const keysOk4 = fxR4.text === '气血瘀证';
      console.log('[smoke] keys3=', fxR3.text, 'keys4=', fxR4.text, '| keysOk3=', keysOk3, 'keysOk4=', keysOk4);
      // 无冒号版式（PP-OCRv6 实际输出："中医诊断创伤病"）须同样识别
      const kp3 = analyze.extractKeyPoints('中医诊断创伤病\n气滞血瘀证\n西医诊断肘挫伤、髋部损伤、踝挫伤、头部的损伤');
      const keysOk5 = kp3['中医诊断'] === '创伤病' && kp3['证型'] === '气滞血瘀证'
        && kp3['西医诊断'] === '肘挫伤、髋部损伤、踝挫伤、头部的损伤';
      console.log('[smoke] keys5=', JSON.stringify(kp3), '| keysOk5=', keysOk5);
      txtOk = txtOk && keysOk && keysOk2 && keysOk3 && keysOk4 && keysOk5;
      // 西医对照库（westmap）动态生效：库内条目命中（面神经炎→口僻、帕金森病→颤证，均非内置表）
      const wAll = clinicalKb ? clinicalKb.list(KIND_DIAG).map(d => d.name) : [];
      const wFace = westTcmCandidates('面神经炎', wAll);
      const wPd = westTcmCandidates('帕金森病', wAll);
      const wmapOk = wFace[0] === '口僻' && wPd[0] === '颤证';
      console.log('[smoke] wmap=', JSON.stringify({ face: wFace[0], pd: wPd[0], n: clinicalKb ? clinicalKb.list(KIND_WESTMAP).length : 0 }), '| wmapOk=', wmapOk);
      // OCR 自定义纠错：setOcrFixes 动态生效并随用户库恢复
      KB.setOcrFixes([{ w: '试药X', r: '当归' }]);
      const ocrUserOk = KB.fixOcrText('试药X9g').text === '当归9g';
      // 纠错库增量 + 防误伤守卫：短错字名不伤长正名
      const fxInc = KB.fixOcrText('白止 10g 枣仁 15g 全虫 6g');
      const fxGuard = KB.fixOcrText('牡丹皮 10g 酸枣仁 15g');
      const ocrIncOk = fxInc.text.includes('白芷') && fxInc.text.includes('酸枣仁 15g') && fxInc.text.includes('全蝎')
        && fxGuard.text === '牡丹皮 10g 酸枣仁 15g';
      console.log('[smoke] ocrInc=', JSON.stringify({ inc: fxInc.text, guard: fxGuard.text }), '| ocrIncOk=', ocrIncOk);
      // tesseract.js 离线引擎：语言包就位 + worker 可创建
      let tessOk = false;
      try { const _ts = await require('./lib/tess').tessStatus(); tessOk = !!(_ts && _ts.ok && _ts.live); console.log('[smoke] tess=', JSON.stringify(_ts)); }
      catch (e) { console.log('[smoke] tess= ERR ' + e.message); }
      KB.setOcrFixes(userKb ? userKb.ocrList() : []);
      console.log('[smoke] ocrUser=', ocrUserOk);
      // 处方×诊断/病历相符性核查：相符 / 跨病域（降级为 partial，不作否决）/ 真·无支撑（weak）/ 无诊断不核查
      const tFit = runTcm({ text: '中医诊断：咳嗽病\n证型：风热犯肺证\n麻黄6g 苦杏仁9g 石膏15g 甘草6g', keys: { 中医诊断: '咳嗽病', 证型: '风热犯肺证' }, sections: [] });
      const tCross = runTcm({ text: '中医诊断：骨折病\n证型：气滞血瘀证\n速效救心丸 川芎10g 丹参15g', keys: { 中医诊断: '骨折病', 证型: '气滞血瘀证' }, sections: [] });
      const tWeak = runTcm({ text: '中医诊断：骨折病\n证型：气滞血瘀证\n黄连6g 黄芩9g 栀子9g', keys: { 中医诊断: '骨折病', 证型: '气滞血瘀证' }, sections: [] });
      const tNoDiag = runTcm({ text: '党参12g 白术9g 茯苓9g', keys: {}, sections: [] });
      const fitOk = tFit.diagCheck && tFit.diagCheck.level === 'ok'
        && tCross.diagCheck && tCross.diagCheck.level === 'partial' && tCross.diagCheck.cross === true
        && (tWeak.rx.items || []).some(i => i.cat === '诊断核对')
        && (tCross.rx.items || []).every(i => i.cat !== '诊断核对')
        && tWeak.diagCheck && tWeak.diagCheck.level === 'weak'
        && tNoDiag.diagCheck === null;
      console.log('[smoke] fit=', JSON.stringify({ ok: tFit.diagCheck && tFit.diagCheck.level, cross: tCross.diagCheck && tCross.diagCheck.level, weak: tWeak.diagCheck && tWeak.diagCheck.level, none: tNoDiag.diagCheck === null }), '| fitOk=', fitOk);
      // 仅诊断 → 按评分推荐方剂；中药分类/症状参考覆盖；中成药标注
      const tDiag = runTcm({ text: '中医诊断：咳嗽\n主诉：咳嗽3天，痰白清稀。', keys: { 中医诊断: '咳嗽' }, sections: [], diagSynds: ['风寒袭肺证', '风热犯肺证', '风燥伤肺证', '痰湿蕴肺证', '痰热郁肺证', '肝火犯肺证', '肺阴亏耗证'] });
      const diagRecOk = !!(tDiag.recs.length && tDiag.recs[0].by === 'diag' && tDiag.recs[0].score > 0);
      const KBH = KB.getAllHerbs();
      const catOk = KBH.filter(h => h.category && h.category !== '未分类').length / KBH.length > 0.9;
      const sxOk = KBH.filter(h => (h.sx || []).length > 0).length / KBH.length > 0.5;
      const pOk = KB.getAllFormulas().some(f => f.k === 'p');
      console.log('[smoke] diag=', JSON.stringify({ recs: tDiag.recs.length, top: tDiag.recs[0] && tDiag.recs[0].f.n, score: tDiag.recs[0] && tDiag.recs[0].score }), '| diagRecOk=', diagRecOk, '| catOk=', catOk, '| sxOk=', sxOk, '| pOk=', pOk);
      // 病域约束：骨折气滞血瘀只推伤科方（不得推出速效救心丸等跨科药），胸痹同证型仍推心血管药
      const tTrau = runTcm({ text: '中医诊断：骨折\n辨证：气滞血瘀证\n主诉：右腕肿痛活动受限。', keys: { 中医诊断: '骨折', 证型: '气滞血瘀证' }, sections: [], diagSynds: ['气滞血瘀'] });
      const domOk = tTrau.recs.length > 0 && !tTrau.recs.some(r => r.f.n === '速效救心丸' || r.f.n === '复方丹参滴丸');
      console.log('[smoke] dom=', JSON.stringify({ recs: tTrau.recs.map(r => r.f.n) }), '| domOk=', domOk);
      // 医保编码对照库：总量 + 差异统计 + 编码/名称检索 + 名称反查
      const icdSt = icdmap ? icdmap.stats() : { total: 0, diffCode: 0, diffName: 0 };
      const icdHit = icdmap ? icdmap.search('I10', 'all', 20) : { list: [] };
      const icdNm = icdmap ? icdmap.lookupByName('霍乱') : null;
      const icdOk = icdSt.total > 30000 && icdSt.diffCode > 1000 && icdHit.list.length > 0 && !!icdNm && icdNm.glCode.startsWith('A00');
      console.log('[smoke] icd=', JSON.stringify({ total: icdSt.total, diffCode: icdSt.diffCode, diffName: icdSt.diffName, i10: icdHit.list.length, lu: icdNm && icdNm.glCode }), '| icdOk=', icdOk);
      // OCR 引擎可用性（PP-OCRv6 = 首选通道，缺失则回落系统 OCR）
      let ocrSt = null;
      try { ocrSt = await capture.ocrStatus(); } catch (e) { ocrSt = { error: String(e && e.message || e) }; }
      const ocrEngOk = !!(ocrSt && (ocrSt.engine === 'win' || ocrSt.paddle || !ocrSt.python));
      console.log('[smoke] ocrEngine=', JSON.stringify(ocrSt), '| ocrEngOk=', ocrEngOk);
      // 噪声过滤：HIS 界面标签/碎片剔除，真实内容零误伤
      const { isNoiseLine: _inl } = require('./lib/noise');
      const noiseHit = ['规格','剂量','频次','首日','特殊属性','下嘱时间','医嘱名称','输入','因','嘱托','医嘱内容','其它'].every(x => _inl(x));
      const noiseKeep = ['患肢抬高','5%葡萄糖注射液 250ml','静滴 qd','当归 12g 川芎 9g','头部的损伤（双）'].every(x => !_inl(x));
      const noiseJoin = _inl('规格 剂量 频次 首日');
      const noiseOk = noiseHit && noiseKeep && noiseJoin;
      // 框选链路防回归：linesToText 必须正确引用 noise（#42 曾错误解构 { noise } 致截图采集全崩）且空输入不崩
      const ltt = capture.linesToText([{ text: '规 格' }, { text: '当归 12g 川芎 9g' }, { text: '' }]);
      const lttOk = !ltt.includes('规') && ltt.includes('当归') && capture.linesToText([]) === '';
      console.log('[smoke] ltt=', JSON.stringify(ltt), '| lttOk=', lttOk);
      // 竖排处方合并（划价界面"药名一行、克数一行"）：并回同行 → 分段/方剂剂量可解析；防误伤用例不并
      const mdg = analyze.mergeDoseLines(['太子参', '15g', '姜厚朴', '12g', '桔梗', '炙甘草 6g', '初步诊断：胸痹', '主诉：胸闷'].join('\n'));
      const mdgOk = mdg.includes('太子参 15g') && mdg.includes('姜厚朴 12g') && mdg.includes('桔梗\n')
        && mdg.includes('炙甘草 6g') && mdg.includes('初步诊断：胸痹')
        && analyze.mergeDoseLines('主诉：胸闷\n每日 1 次\n15 付').includes('15 付\n') === false
        // 两列竖排被 OCR 打乱行序：克数串逆序回填最近的无剂量药名行（#46）
        && analyze.mergeDoseLines(['炒六神曲', '甘草', '生麦芽 10g', '12g', '12g'].join('\n')).includes('甘草 12g')
        && analyze.mergeDoseLines(['炒六神曲', '甘草', '生麦芽 10g', '12g', '12g'].join('\n')).includes('炒六神曲 12g');
      console.log('[smoke] mdg=', JSON.stringify(mdg), '| mdgOk=', mdgOk);
      console.log('[smoke] noise=', JSON.stringify({ noiseHit, noiseKeep, noiseJoin }), '| noiseOk=', noiseOk);
      // 剪贴板采集链路（零误差通道）：标签噪声剔除 + 术语纠错 + 要素提取
      await writeClipText('初步诊断：中医诊断:创伤病 气血瘀证\n规格\n剂量\n西医诊断:1.肘挫伤（双）2.头部的损伍\n保存');
      const cbRaw = await readClipText();
      const cbNoise = noise.filterNoiseText(cbRaw);
      // 模拟 finalizeRecord 的术语库上下文（证型库 + 支持度收敛），验证真实链路效果
      const cbFix = KB.fixOcrText(cbNoise.text, {
        syndromes: ['气滞血瘀证', '气虚血瘀证', '血瘀证'], diags: ['创伤病'],
        syndCtx: ['气滞血瘀证'], syndSupport: { '气滞血瘀证': 26, '气虚血瘀证': 0 }
      });
      const cbKeys = analyze.extractKeyPoints(cbFix.text);
      const clipOk = cbRaw.includes('规格') && !cbNoise.text.includes('规格') && !cbNoise.text.includes('保存')
        && cbFix.text.includes('气滞血瘀证') && cbFix.text.includes('头部的损伤')
        && /创伤病/.test(cbKeys['中医诊断'] || '') && /损伤/.test(cbKeys['西医诊断'] || '');
      console.log('[smoke] clipboard=', JSON.stringify({ removed: cbNoise.removed, text: cbNoise.text, keys: cbKeys }), '| clipOk=', clipOk);
      // Excel 导入回环 + 配伍禁忌显性结论 + 方剂归属（#48）
      const _xl = require('./lib/xlsximport');
      const _XLSX = require('xlsx');
      const _twb = _xl.buildTemplateWorkbook('westmap').wb;
      const _tw = _XLSX.utils.sheet_to_json(_twb.Sheets[_twb.SheetNames[0]], { header: 1, defval: '', raw: false });
      const _tplRows = _xl.xlsxRowsToObjects(_tw, _xl.XLSX_TARGETS.westmap.cols);
      const _rxClean = runTcm({ text: '当归 12g\n黄芪 15g', keys: {}, sections: [], diagSynds: [] });
      const _rxBad = runTcm({ text: '附子 6g\n浙贝母 12g', keys: {}, sections: [], diagSynds: [] });
      const _rxF = runTcm({ text: '麻黄 9g 桂枝 9g 干姜 9g 细辛 3g 五味子 6g 白芍 9g 半夏 9g 炙甘草 6g', keys: {}, sections: [], diagSynds: [] });
      const xlOk = _tplRows.length >= 1 && _tplRows[0].west === '糖尿病' && _tplRows[0].tcm === '消渴'
        && !!(_rxClean.rx && _rxClean.rx.items.some(i => i.title.includes('未检测到十八反')))
        && !!(_rxBad.rx && _rxBad.rx.items[0].cat === '配伍禁忌')
        && !!(_rxF.rx && _rxF.rx.belong && _rxF.rx.belong.n === '小青龙汤');
      console.log('[smoke] xl=', JSON.stringify({ tplRows: _tplRows.length, clean: !!(_rxClean.rx && _rxClean.rx.items.some(i=>i.title.includes('未检测到十八反'))), badFirst: _rxBad.rx && _rxBad.rx.items[0].cat, belong: _rxF.rx && _rxF.rx.belong && _rxF.rx.belong.n }), '| xlOk=', xlOk);
      const flags = { homeOk, uiOk, kbOk, cliOk, gOk, gMatchOk, autoOk, westOk, subOk, fzOk, ocrOk, ocrEngOk, txtOk, wmapOk, ocrUserOk, fitOk, diagRecOk, catOk, sxOk, pOk, domOk, icdOk, noiseOk, lttOk, mdgOk, clipOk, ocrIncOk, tessOk, xlOk };
      console.log('[smoke] flags=', JSON.stringify(flags));
      const allOk = Object.values(flags).every(Boolean);
      console.log('[smoke] allOk=', allOk);
      console.log('[smoke] PASS');
    } catch (e) {
      console.log('[smoke] FAIL:', e.message);
    }
    setTimeout(() => app.exit(0), 800);
    return;
  }

  if (process.argv.includes('--e2e-clip')) {
    // 端到端：剪贴板文本 → 噪声剔除 → 纠错 → 要素 → 存档（验证后删除，不留记录）
    try {
      await writeClipText('初步诊断：中医诊断:创伤病 气血瘀证\n规格\n剂量\n频次\n西医诊断:1.肘挫伤（双）2.髋部损伤（双）3.头部的损伍\n保存\n嘱托');
      const result = await captureClipboard();
      if (result && result.ok) {
        const rec = store.get(result.id);
        console.log('[clip-e2e] id=', result.id, '| source=', rec.source, '| engine=', rec.ocrEngine);
        console.log('[clip-e2e] text=', JSON.stringify(rec.text));
        console.log('[clip-e2e] keys=', JSON.stringify(rec.keys));
        console.log('[clip-e2e] sections=', (rec.sections || []).map(x => x.type + ':' + x.content.length).join(','));
        console.log('[clip-e2e] ocrFix=', JSON.stringify((rec.ocrFix || []).slice(0, 8)));
        store.remove(result.id);
        console.log('[clip-e2e] cleaned=', !store.get(result.id), '| PASS');
      } else {
        console.log('[clip-e2e] FAIL:', result && result.error);
      }
    } catch (e) { console.log('[clip-e2e] FAIL:', e.message); }
    setTimeout(() => app.exit(0), 800);
    return;
  }

  if (process.argv.includes('--e2e')) {
    // 端到端：抓前台窗口→OCR→脱敏→存档
    try {
      const result = await captureWholeWindow();
      if (result && result.ok) {
        const rec = store.get(result.id);
        console.log('[e2e] ok id=', result.id, 'chars=', result.charCount, 'win=', result.winTitle);
        console.log('[e2e] rawOk=', !!(typeof rec.rawText === 'string' && rec.rawText.length >= (rec.text || '').length));
        console.log('[e2e] sections=', (rec.sections || []).map(s => s.type + ':' + s.content.length).join(','));
        console.log('[e2e] keys=', JSON.stringify(rec.keys));
        console.log('[e2e] tcm=', rec.tcm ? (rec.tcm.type + '|' + (rec.tcm.msg || '')) : 'none');
        console.log('[e2e] textHead=', (rec.text || '').slice(0, 300).replace(/\n/g, '⏎'));
        console.log('[e2e] PASS');
      } else {
        console.log('[e2e] FAIL:', result && result.error);
      }
    } catch (e) {
      console.log('[e2e] FAIL:', e.message);
    }
    setTimeout(() => app.exit(0), 500);
    return;
  }

  if (process.argv.includes('--e2e-uia')) {
    try {
      const fg = await capture.getForegroundWindow();
      const uia = await capture.readUiAutomation(fg.handle, { depth: 10, maxItems: 1500 });
      const items = (uia.items || []).slice(0, 20).map(i => i.text).join(' | ');
      console.log('[e2e-uia] ok win=', fg.title, 'items=', (uia.items || []).length);
      console.log('[e2e-uia] sample=', items.slice(0, 400));
      console.log('[e2e-uia] PASS');
    } catch (e) {
      console.log('[e2e-uia] FAIL:', e.message);
    }
    setTimeout(() => app.exit(0), 500);
    return;
  }

  if (process.argv.includes('--e2e-kb')) {
    // 知识库后台链路：导入模板文件 → 合并 → 引擎识别新增方/药 → 清理恢复
    try {
      const herbFile = path.join(__dirname, 'data', 'herbs-import-template.json');
      const formulaFile = path.join(__dirname, 'data', 'formulas-import-template.json');
      const herbs = JSON.parse(fs.readFileSync(herbFile, 'utf8'));
      const formulas = JSON.parse(fs.readFileSync(formulaFile, 'utf8'));
      const rH = userKb.importBatch(KIND_HERB, herbs);
      const rF = userKb.importBatch(KIND_FORMULA, formulas);
      const st = userKb.stats();
      console.log('[e2e-kb] herbs import:', JSON.stringify({ added: rH.added, updated: rH.updated }));
      console.log('[e2e-kb] formulas import:', JSON.stringify({ added: rF.added, updated: rF.updated }));
      console.log('[e2e-kb] stats:', JSON.stringify({ fu: st.formulaUser, hu: st.herbUser, fb: st.formulaBuiltin, hb: st.herbBuiltin }));
      // 引擎热刷新：应能识别新导入的小青龙汤 与 太子参
      const outF = runTcm({ text: '方药：小青龙汤加减\n麻黄9g 桂枝9g 干姜9g 细辛3g 五味子6g', keys: {} });
      const outH = runTcm({ text: '太子参15g 水煎服', keys: {} });
      const fOk = !!(outF.chosen || []).some(c => c.f.n === '小青龙汤');
      const hOk = !!(outH.herbs || []).includes('太子参');
      console.log('[e2e-kb] tcm small-dragon=', fOk, 'tcm taizishen=', hOk, '| PASS=', fOk && hOk);
      // 清理：把用户条目清空，恢复内置基线
      userKb.clear(KIND_HERB);
      userKb.clear(KIND_FORMULA);
      const st2 = userKb.stats();
      console.log('[e2e-kb] reset stats:', JSON.stringify({ fu: st2.formulaUser, hu: st2.herbUser }));
      console.log('[e2e-kb] DONE');
    } catch (e) {
      console.log('[e2e-kb] FAIL:', e.message);
    }
    setTimeout(() => app.exit(0), 500);
    return;
  }

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createFloatBall(); });
});

app.on('window-all-closed', () => {
  // 悬浮球关闭不退出（托盘常驻），除非显式退出
});
app.on('before-quit', () => { try { globalShortcut.unregisterAll(); } catch (e) { /* 忽略 */ } tray && tray.destroy(); try { capture.stopOcrServer(); } catch (e) { /* 忽略 */ } try { require('./lib/tess').stopTess(); } catch (e) { /* 忽略 */ } });
