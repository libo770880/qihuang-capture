// 取证：① 顶栏底色随主题（亮/扁平/暗）切换；② 顶栏「使用说明」模块（分节导航 / 关键词定位 / 返回记录）
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
app.disableHardwareAcceleration();
const OUT = path.join(__dirname, '..', '.probe', 'ui');
fs.mkdirSync(OUT, { recursive: true });

const TCM = require('../lib/tcm');
const RXQC = require('../lib/rxqc');
const COMP = require('../lib/compliance');

const TEXT = '中医诊断：咳嗽\n证型：痰湿蕴肺证\n黄芪 15g\n白术 10g\n茯苓 12g\n每日1剂 水煎服\n共3味7剂';
const tcm = TCM.runTcm({ text: TEXT });
const qc = RXQC.check({ text: TEXT, tcm, usage: '每日1剂 水煎服' });
const REC = {
  id: 'hp-1', ts: '2026-10-18T04:00:00.000Z', source: 'region',
  text: TEXT, rawText: TEXT, keys: {},
  tcm, qc, compliance: COMP.runCompliance({ text: TEXT, keys: {} }),
  usage: '每日1剂 水煎服', an: { auto: true, at: Date.now(), diag: '咳嗽', synd: '痰湿蕴肺证' },
  sections: [{ kind: 'rx', title: '处方', text: TEXT }],
};
ipcMain.handle('panel:list', () => [REC]);
ipcMain.handle('record:analyze', () => ({ ok: true, compliance: REC.compliance, tcm, qc, focusN: 0, hasRecord: true, tcmOk: true, msg: '分析完成' }));
ipcMain.handle('kb:list-all', () => [
  { name: '黄芪', dose: '9~30g' }, { name: '白术', dose: '6~12g' }, { name: '茯苓', dose: '10~15g' },
]);
for (const ch of ['sys:get', 'ai:config-get', 'records:list', 'kb:list', 'ref:meta', 'ref:list', 'ref:search',
  'userkb:list', 'backup:mirror-info', 'ocr:config-get', 'yb:list', 'sbf:list', 'unm:list', 'rxrule:get',
  'west:candidates', 'kb:stats', 'kb:yibao-list']) {
  try { ipcMain.handle(ch, () => ({})); } catch (e) {}
}

const CHECKS = [
  ['helpBtn', '顶栏出现「❔ 使用说明」入口'],
  ['helpOpen', '点击后主区渲染说明页 .hwrap（标题「使用说明」）'],
  ['sections', '分节导航 9 节（快速上手 / 采集方式 / 识别质检 / 处方指标 / 审方辨证 / 记录管理 / 后台配置 / 快捷键 / 常见问题）'],
  ['defaultSec', '默认节为「快速上手」，含 1/2/3 三步卡片'],
  ['captureSec', '切到「采集方式」：表格 5 种方式且含「粘贴采集 / 框选抓取」'],
  ['search', '搜索「红线」：显示匹配数并高亮 mark.hmark'],
  ['back', '「‹ 返回记录」退出说明页（.hwrap 消失，回到记录详情）'],
  ['themeLight', '亮色主题：顶栏底色 #123f28'],
  ['themeFlat', '扁平主题：顶栏底色 #2563eb（随主题变蓝）'],
  ['themeDark', '暗色主题：顶栏底色 #161e10（不再是浅底浅字）'],
  ['darkContrast', '暗色顶栏文字/背景对比度 ≥ 7（可读性）'],
];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function lum(rgb) {
  const p = rgb.map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1100, height: 760, show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true } });
  win.webContents.on('console-message', (e, l, m) => { if (l >= 2) console.error('PAGE:', String(m).slice(0, 200)); });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'panel.html'));
  await sleep(1500);
  // 关闭过渡动画：离屏窗口不推进 transition，getComputedStyle 会读到起点色
  await win.webContents.executeJavaScript(`(function(){ const s=document.createElement('style');
    s.textContent='*{transition:none!important}'; document.head.appendChild(s); return true; })()`);
  const out = {};

  out.helpBtn = await win.webContents.executeJavaScript(`(function(){
    const b = document.getElementById('btnHelp');
    return !!b && /使用说明/.test(b.textContent || '');
  })()`);

  await win.webContents.executeJavaScript(`(function(){ showHelp(); return true; })()`);
  await sleep(350);
  const h1 = await win.webContents.executeJavaScript(`(function(){
    const w = document.querySelector('.hwrap');
    return { has: !!w, title: w ? (w.querySelector('.dt')||{}).textContent : '',
      navN: document.querySelectorAll('#helpNav button').length,
      sec: (document.querySelector('#helpCard .hcard')||{}).dataset ? document.querySelector('#helpCard .hcard').dataset.s : '',
      steps: document.querySelectorAll('.hstep').length,
      txt: (document.querySelector('#helpCard')||{}).textContent || '' };
  })()`);
  console.error('open=' + JSON.stringify({ has: h1.has, navN: h1.navN, sec: h1.sec, steps: h1.steps }));
  out.helpOpen = h1.has && /使用说明/.test(h1.title || '');
  out.sections = h1.navN === 9;
  out.defaultSec = h1.sec === 'start' && h1.steps === 3;

  await win.webContents.executeJavaScript(`(function(){ helpGo('capture'); return true; })()`);
  await sleep(250);
  const cap = await win.webContents.executeJavaScript(`(function(){
    const c = document.querySelector('#helpCard .hcard');
    const heads = [...(c||document.querySelectorAll('.hcard')).querySelectorAll('thead th')].map(x=>x.textContent.trim());
    return { rows: (c||document).querySelectorAll('tbody tr').length, txt: (c||document).textContent || '',
      th: heads, navOn: (document.querySelector('#helpNav button.on')||{}).textContent || '' };
  })()`);
  console.error('capture=' + JSON.stringify({ rows: cap.rows, th: cap.th, navOn: cap.navOn }));
  out.captureSec = cap.rows === 5 && /粘贴采集/.test(cap.txt) && /框选抓取/.test(cap.txt);

  await win.webContents.executeJavaScript(`(function(){ const q=document.getElementById('helpQ');
    q.value='红线'; helpSearch(q.value); return true; })()`);
  await sleep(250);
  const sr = await win.webContents.executeJavaScript(`(function(){
    return { cnt: (document.getElementById('helpCnt')||{}).textContent || '',
      marks: document.querySelectorAll('#helpCard mark.hmark').length,
      hitBtns: document.querySelectorAll('#helpNav button.hit').length,
      sec: (document.querySelector('#helpCard .hcard')||{}).dataset ? document.querySelector('#helpCard .hcard').dataset.s : '' };
  })()`);
  console.error('search=' + JSON.stringify(sr));
  out.search = /共 \d+ 处匹配/.test(sr.cnt) && sr.marks >= 1 && sr.hitBtns >= 1 && sr.sec === 'metric';

  await win.webContents.executeJavaScript(`(function(){ document.querySelector('.hwrap .ghost').click(); return true; })()`);
  await sleep(400);
  out.back = await win.webContents.executeJavaScript(`(function(){
    return !document.querySelector('.hwrap') && !!(document.querySelector('.dhead') || document.querySelector('.empty'));
  })()`);

  // 顶栏底色随主题（CSS 变量 --topbar）
  const themeColor = async (t) => win.webContents.executeJavaScript(`(function(){
    applyTheme('${t}');
    return getComputedStyle(document.querySelector('.top')).backgroundColor;
  })()`);
  const parse = s => (s.match(/\d+/g) || []).map(Number).slice(0, 3);
  const cLight = parse(await themeColor('light'));
  const cFlat = parse(await themeColor('flat'));
  const cDark = parse(await themeColor('dark'));
  console.error('colors=' + JSON.stringify({ cLight, cFlat, cDark }));
  out.themeLight = cLight[0] === 18 && cLight[1] === 63 && cLight[2] === 40;
  out.themeFlat = cFlat[0] === 37 && cFlat[1] === 99 && cFlat[2] === 235;
  out.themeDark = cDark[0] === 22 && cDark[1] === 30 && cDark[2] === 16;
  const fg = parse(await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.top')).color`));
  const L1 = lum(cDark), L2 = lum(fg);
  const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  console.error('contrast=' + ratio.toFixed(2) + ' fg=' + JSON.stringify(fg));
  out.darkContrast = ratio >= 7;

  // 截图：亮色「快速上手」+ 暗色「处方指标」（先清搜索状态，避免残留跳节）
  try {
    await win.webContents.executeJavaScript(`(function(){ helpQ=''; applyTheme('light'); showHelp('start'); return true; })()`);
    await sleep(600);
    let img = await win.capturePage();
    fs.writeFileSync(path.join(OUT, 'help-light.png'), img.toPNG());
    await win.webContents.executeJavaScript(`(function(){ applyTheme('dark'); showHelp('metric'); return true; })()`);
    await sleep(600);
    img = await win.capturePage();
    fs.writeFileSync(path.join(OUT, 'help-dark.png'), img.toPNG());
    await win.webContents.executeJavaScript(`(function(){ applyTheme('light'); return true; })()`);
  } catch (e) { console.error('shot fail: ' + e.message); }

  let pass = 0;
  for (const [k, desc] of CHECKS) {
    const ok = !!out[k]; if (ok) pass++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${k.padEnd(13)} ${desc}`);
  }
  console.log(`${pass}/${CHECKS.length} ${pass === CHECKS.length ? 'ALL_OK' : 'HAS_FAIL'}`);
  app.quit();
  process.exit(pass === CHECKS.length ? 0 : 1);
});
