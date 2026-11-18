// scripts/_rec_search.js - 知识检索页（search.html）演示动图
// 流程：全库总览 → 症状直达「眩晕」→ 打开半夏白术天麻汤详情 → 详情滚动（组成/加减/注意）
// 用法：electron scripts/_rec_search.js
const { app, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const { Recorder, openWin, sleep } = require('../lib/rec-core');
const KB = require('../lib/kb');
const UD = path.join(os.homedir(), 'AppData', 'Roaming', '岐黄鉴方·悬浮采集助手');

const log = (m) => console.log('[rec] ' + m);
ipcMain.handle('kb:list-all', () => ({ herbs: KB.getAllHerbs(), formulas: KB.getAllFormulas() }));
ipcMain.handle('app:version', () => 'demo');
ipcMain.handle('kb:yibao-list', () => []);
ipcMain.handle('sys:get', () => ({}));
ipcMain.handle('kb:clinical-upsert', () => ({ ok: true }));
ipcMain.handle('consult:ctx', () => null);

app.whenReady().then(async () => {
  const win = await openWin('search.html', 1100, 720);
  const r = new Recorder('17-知识检索详情', win, 10);
  const js = r.js;
  await sleep(900);
  await r.start();
  r.mark('① 知识检索：709 条 · 方剂 332 首 · 内置库+本院自建实时合并');
  await r.wait(2000);
  r.mark('② 症状直达：点「眩晕」→ 秒筛主治命中方剂');
  const sxOk = await js(`(() => { const c = [...document.querySelectorAll('.kbs .chips .c')].find(x => x.textContent.trim() === '眩晕' || x.dataset.sx === '眩晕'); if (!c) return false; c.click(); return true; })()`);
  if (!sxOk) log('WARN: 眩晕 chip 未找到');
  await r.wait(1800);
  r.mark('③ 打开「半夏白术天麻汤」→ 内置知识库全维详情');
  const liOk = await js(`(() => { const li = [...document.querySelectorAll('.kbs .li')].find(x => /半夏白术天麻汤/.test(x.textContent)); if (!li) return false; li.click(); return true; })()`);
  if (!liOk) log('WARN: 半夏白术天麻汤 未命中');
  await r.wait(1800);
  r.mark('④ 主治 / 组成 / 功效 / 用法 一屏读全');
  await js(`(() => { const d = document.querySelector('.kbs .det'); if (d) d.scrollTo({ top: 260, behavior: 'smooth' }); return 1; })()`);
  await r.wait(1700);
  r.mark('⑤ 加减随证化裁 · 注意事项 · 出处页码可溯');
  await js(`(() => { const d = document.querySelector('.kbs .det'); if (d) d.scrollTo({ top: 620, behavior: 'smooth' }); return 1; })()`);
  await r.wait(1900);
  r.mark('⑥ 同一知识库 · 供审方与辨证咨询实时调用');
  await js(`(() => { const d = document.querySelector('.kbs .det'); if (d) d.scrollTo({ top: 0, behavior: 'smooth' }); return 1; })()`);
  await r.wait(2000);
  const meta = await r.stop();
  win.destroy();
  log('scene search -> ' + JSON.stringify(meta));
  app.quit();
}).catch(e => { console.error(e); app.exit(1); });
