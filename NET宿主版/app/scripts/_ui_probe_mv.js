// scripts/_ui_probe_mv.js - 「数据搬家」卡片渲染自检（Electron 离屏）
// 用桩桥（stub preload）加载真实 renderer/admin.html → 调 sysInit() → 读 #mvAudit 的渲染结果。
// 只验证：页面脚本无语法错误、审计数据能渲染成表格、按钮存在。不碰真实数据目录。
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qhjf-mv-'));

// 1) 用真实库副本跑一次审计，拿到渲染数据
const srcDb = process.argv.find(a => /\.db$/i.test(a)) ||
  path.join(process.env.APPDATA || '', '岐黄鉴方·悬浮采集助手', 'data.db');
const ud = path.join(TMP, 'ud');
fs.mkdirSync(ud, { recursive: true });
if (fs.existsSync(srcDb)) fs.copyFileSync(srcDb, path.join(ud, 'data.db'));

const code = null;
// 直接在主进程内算审计（进程内已有 node:sqlite；不要 spawn electron.exe -e，会再起一个 GUI 实例）
const DB = require(path.join(ROOT, 'lib', 'db.js'));
const dp = require(path.join(ROOT, 'lib', 'dataport.js'));
DB.initDb(ud, () => {});
const audit = dp.audit(ud);

// 2) 桩桥：所有未实现的方法都返回空对象；dataAudit 返回真数据
const preload = path.join(TMP, 'stub-preload.js');
fs.writeFileSync(preload, `
const AUDIT = ${JSON.stringify(audit)};
const real = {
  dataAudit: () => Promise.resolve(AUDIT),
  dataInfo: () => Promise.resolve({ dir: AUDIT.dir, portable: true }),
  sysGet: () => Promise.resolve({ appName: '岐黄鉴方', loginMode: 'none', hasAdmin: false, backups: [], depts: [] }),
  sysUsersList: () => Promise.resolve({ users: [], depts: [] }),
  sysLogsGet: () => Promise.resolve({ lines: [] }),
  uiPrefsGet: () => Promise.resolve({ prefs: {} }),
  uiPrefsSet: () => Promise.resolve({ ok: true })
};
window.qhjf = new Proxy(real, {
  get: (t, k) => (k in t ? t[k] : () => Promise.resolve({}))
});
`);

app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1280, height: 900,
    webPreferences: { preload, contextIsolation: false, nodeIntegration: false, sandbox: false },
  });
  const logs = [];
  win.webContents.on('console-message', (_e, level, msg) => logs.push(msg));
  await win.loadFile(path.join(ROOT, 'renderer', 'admin.html'));
  await new Promise(r => setTimeout(r, 800));
  const out = await win.webContents.executeJavaScript(`(async function(){
    try { await sysInit(); } catch(e) { return { error: String(e && e.message || e) }; }
    await new Promise(r => setTimeout(r, 600));
    const el = document.getElementById('mvAudit');
    const html = el ? el.innerHTML : '';
    return {
      hasCard: !!el,
      len: html.length,
      rows: (html.match(/<tr>/g) || []).length,
      hasDb: html.indexOf('data.db') >= 0,
      hasAuditHead: html.indexOf('配置项') >= 0,
      allInDbTip: html.indexOf('全部配置项均在') >= 0,
      buttons: ['mvExportCfg','mvImportCfg','mvExportDb'].filter(f => typeof window[f] === 'function').length,
      text: (el ? el.textContent : '').slice(0, 260)
    };
  })()`);
  console.log('[mv-ui] ' + JSON.stringify(out));
  try {
    win.show(); // 隐藏窗口 capturePage 渲染不全，短暂显示后截屏
    await win.webContents.executeJavaScript("switchView('sys'); var c=document.getElementById('mvAudit') && document.getElementById('mvAudit').closest('.card'); if(c) c.scrollIntoView({block:'center'}); 1");
    await new Promise(r => setTimeout(r, 600));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(ROOT, '.probe', 'mv-card.png'), img.toPNG());
    console.log('[mv-ui] shot -> .probe/mv-card.png');
  } catch (e) { console.log('[mv-ui] shot fail ' + e.message); }
  if (out && !out.error && out.hasCard && out.rows >= 9 && out.hasAuditHead && out.buttons === 3) console.log('[mv-ui] PASS');
  else { console.log('[mv-ui] FAIL logs=' + JSON.stringify(logs.slice(-5))); }
  app.exit(out && !out.error && out.rows >= 9 ? 0 : 1);
});
