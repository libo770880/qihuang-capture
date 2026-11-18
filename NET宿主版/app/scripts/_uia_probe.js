// scripts/_uia_probe.js - 验证 Electron 自身窗口可被 uia.ps1 读到控件文本
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-renderer-accessibility');
app.commandLine.appendSwitch('enable-features', 'UiaProvider');
app.whenReady().then(()=>app.setAccessibilitySupportEnabled(true));
app.whenReady().then(async () => {
  const { runPs } = require('../lib/ps');
  const win = new BrowserWindow({ width: 700, height: 500 });
  await win.loadURL('data:text/html,' + encodeURIComponent(
    '<h2>住院医生站 - 医嘱浏览</h2><p>患者：李某 女 47岁</p><p>中医诊断：胸痹（心血瘀阻证）</p><p>丹参 15g　川芎 9g　红花 6g</p>'));
  await new Promise(r => setTimeout(r, 5000));
  try {
    const r = await runPs('uia.ps1', { Handle: win.getNativeWindowHandle().readInt32LE(0), Depth: 8, MaxItems: 300 }, 30000);
    console.log('ok=' + r.ok, 'title=' + (r.title||''), 'items=' + (r.items||[]).length);
    console.log((r.items||[]).slice(0,10).map(i=>i.text).join(' | ').slice(0,500));
  } catch (e) { console.log('ERR', e.message); }
  app.exit(0);
});
