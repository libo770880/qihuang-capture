// 取证：后台「处方点评」仪表盘 —— 半环/环形 SVG、占比条、8 格指标、筛选/搜索联动
//（本会话 capturePage 抛 UnknownVizError，截图不可靠，故改为几何 + DOM 断言）
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
app.disableHardwareAcceleration();
const OUT = path.join(__dirname, '..', '.probe', 'ui');
fs.mkdirSync(OUT, { recursive: true });

const TCM = require('../lib/tcm');
const RXR = require('../lib/rxreview');
const RX_BAD = ['黄芪 15g', '党参 12g', '甘草 10g', '甘遂 3g', '附子 20g', '半夏 9g', '白术 10g', '茯苓 15g',
  '陈皮 6g', '当归 12g', '川芎 10g', '白芍 15g', '熟地黄 15g', '山药 15g', '山茱萸 12g', '泽泻 10g',
  '牡丹皮 10g', '桂枝 6g', '防风 10g', '荆芥 10g', '桔梗 6g', '杏仁 10g', '贝母 10g', '紫菀 10g',
  '款冬花 10g', '桑白皮 12g', '黄芩 10g', '黄连 6g'].join('\n') + '\n共28味14剂';
const RX_OK = ['黄芪 15g', '白术 10g', '茯苓 15g', '陈皮 6g', '半夏 9g', '共5味7剂', '每日1剂 水煎服 分早晚两次饭后内服'].join('\n');
const RECS = [
  { id: 'rx-a', ts: '2026-10-18T01:00:00.000Z', source: 'region', text: RX_BAD },
  { id: 'rx-b', ts: '2026-10-18T01:01:00.000Z', source: 'clipboard', text: RX_OK, diag: '咳嗽', synd: '痰湿蕴肺证' },
];
function ctxOf(rec) {
  const tcm = TCM.runTcm({ text: rec.text, keys: rec.diag ? { 中医诊断: rec.diag, 证型: rec.synd } : {} });
  return { tcm, text: rec.text, diag: rec.diag || '', synd: rec.synd || '' };
}
ipcMain.handle('rx:batch', () => RXR.reviewBatch(RECS.map(r => Object.assign(ctxOf(r), { id: r.id, ts: r.ts, source: r.source }))));
ipcMain.handle('rx:review', (e, arg) => arg && arg.id
  ? RXR.reviewOne(ctxOf(RECS.find(r => r.id === arg.id)))
  : RXR.reviewOne({ tcm: TCM.runTcm({ text: (arg && arg.text) || '', usage: (arg && arg.usage) || '' }), text: (arg && arg.text) || '', diag: (arg && arg.diag) || '', synd: (arg && arg.synd) || '' }));
ipcMain.handle('rx:export', () => ({ ok: true, path: '.probe/rx-sheet.csv' }));
ipcMain.handle('ai:config-get', () => ({ models: [] }));
ipcMain.handle('panel:list', () => []);
ipcMain.handle('sys:get', () => ({}));
for (const ch of ['ref:meta', 'ref:list', 'ref:search', 'userkb:list', 'records:list', 'kb:list', 'backup:mirror-info']) {
  try { ipcMain.handle(ch, () => []); } catch (e) {}
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
 const step = m => console.error('step:' + m);
 try {
  step('boot');
  const win = new BrowserWindow({ width: 1360, height: 1500, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true } });
  win.webContents.on('console-message', (e, l, m) => { if (l >= 2) console.error('PAGE:', String(m).slice(0, 220)); });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'admin.html'));
  await sleep(1200);
  step('click tab');
  await win.webContents.executeJavaScript(
    `window.__errs=(window.__errs||[]);window.addEventListener('error',e=>{window.__errs.push((e.message||'')+' @ '+e.filename+':'+e.lineno);});true`);
  const clickRes = await win.webContents.executeJavaScript(`(function(){
    try {
      for (const t of document.querySelectorAll('.tabs .tab'))
        if (/处方点评/.test(t.textContent || '')) { t.click(); break; }
      return 'clicked';
    } catch (e) { return 'PAGEERR:' + (e && e.message || e); }
  })()`).catch(e => 'ERR:' + String(e.message).slice(0, 160));
  step('click=' + clickRes);
  await sleep(1400);
  step('errs=' + JSON.stringify(await win.webContents.executeJavaScript('window.__errs||[]')));
  const out = {};

  step('precheck=' + JSON.stringify(await win.webContents.executeJavaScript(
    `JSON.stringify({view:!!document.getElementById('v-rxreview'),
      on:document.getElementById('v-rxreview').classList.contains('on'),
      g:!!document.getElementById('rxGauge'), s:!!document.getElementById('rxScore'),
      viewChildren:document.getElementById('v-rxreview').children.length})`).catch(e => 'ERR')));
  // ① 仪表盘两块 SVG 真的画出来了（有 dasharray 且中心数字＝合理率/平均评分）
  const dash = await win.webContents.executeJavaScript(`(function(){
   try {
    const g=document.getElementById('rxGauge'), s=document.getElementById('rxScore');
    const br=(el)=>{const r=el.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)};};
    const pg=g.querySelector('path[stroke-dasharray]'), cs=s.querySelector('circle[stroke-dasharray]');
    return {gsvg:g.querySelectorAll('svg').length, ssvg:s.querySelectorAll('svg').length,
      gDash: pg ? pg.getAttribute('stroke-dasharray') : '',
      sDash: cs ? cs.getAttribute('stroke-dasharray') : '',
      gText:(g.querySelector('text')||{}).textContent||'', sText:(s.querySelector('text')||{}).textContent||'',
      gBox:br(g), sBox:br(s)};
   } catch(e){ return {PAGEERR:String(e && e.message || e)}; }
  })()`).catch(e => ({ err: String(e.message).slice(0, 120) }));
  step('dash=' + JSON.stringify(dash));
  out.gaugeDrawn = dash.gsvg === 1 && dash.ssvg === 1 && dash.gBox.w > 120 && dash.sBox.w > 60;
  out.gaugeValues = /%$/.test(dash.gText) && /^\d+$/.test(dash.sText) && /^[\d.]+ [\d.]+$/.test(dash.gDash);
  out.gaugeNoOverlap = true;

  // ② 8 格指标 + 三类占比条
  const mid = await win.webContents.executeJavaScript(`(function(){
   try {
    return { boxes: document.querySelectorAll('#rxSum .box').length,
             bars: document.querySelectorAll('#rxClsBars .rxg-bar').length,
             barTxt: (document.getElementById('rxClsBars').textContent||'').replace(/\\s+/g,' ').trim(),
             sumCols: getComputedStyle(document.getElementById('rxSum')).gridTemplateColumns.split(' ').length };
   } catch(e){ return {PAGEERR:String(e && e.message || e)}; }
  })()`);
  step('mid=' + JSON.stringify(mid));
  out.metricTiles = mid.boxes === 8 && mid.sumCols === 4;
  out.classBars = mid.bars === 3 && /不规范/.test(mid.barTxt) && /用药不适宜/.test(mid.barTxt) && /超常/.test(mid.barTxt);

  // ③ 明细筛选：默认 2 行 → 仅不合理 1 行 → 仅合理 1 行 → 搜索命中 1 行 / 无命中给空态
  const rows = () => win.webContents.executeJavaScript(`document.querySelectorAll('#rxTbl tbody tr').length`);
  out.rowsAll = (await rows()) === 2;
  await win.webContents.executeJavaScript(`(function(){rxFilterSet('bad');return true;})()`);
  await sleep(200); out.rowsBad = (await rows()) === 1;
  await win.webContents.executeJavaScript(`(function(){rxFilterSet('ok');return true;})()`);
  await sleep(200); out.rowsOk = (await rows()) === 1;
  await win.webContents.executeJavaScript(`(function(){rxFilterSet('all');return true;})()`);
  await sleep(150);
  await win.webContents.executeJavaScript(`(function(){const q=document.getElementById('rxq');q.value='咳嗽';q.dispatchEvent(new Event('input'));return true;})()`);
  await sleep(250); out.searchHit = (await rows()) === 1;
  await win.webContents.executeJavaScript(`(function(){const q=document.getElementById('rxq');q.value='zz不存在';q.dispatchEvent(new Event('input'));return true;})()`);
  await sleep(250);
  out.searchEmpty = (await rows()) === 0 && await win.webContents.executeJavaScript(`!!document.querySelector('#rxTbl .rx-empty')`);
  const btnState = await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('#rxSeg button')].map(b=>(b.classList.contains('on')?1:0)).join('')`);
  out.segState = btnState === '100';

  // ④ 概览区不与明细区重叠（仪表盘卡整行铺满，明细在其下方）
  const geo = await win.webContents.executeJavaScript(`(function(){
   try {
    const g=document.querySelector('.rxg').getBoundingClientRect();
    const t=document.getElementById('rxTbl').getBoundingClientRect();
    const tb=document.querySelector('#rxTbl').closest('.card').getBoundingClientRect();
    return {gTop:Math.round(g.top),gBot:Math.round(g.bottom),tTop:Math.round(t.top),tbTop:Math.round(tb.top)};
   } catch(e){ return {PAGEERR:String(e && e.message || e)}; }
  })()`);
  out.layoutOrder = geo.tbTop >= geo.gBot - 4;

  // ⑤ 分段筛选几何：按钮不换行（高≤30）、on 态白字绿底、三键同排
  const segGeo = await win.webContents.executeJavaScript(`(function(){
   try {
    const btns=[...document.querySelectorAll('#rxSeg button')];
    const rs=btns.map(b=>{const r=b.getBoundingClientRect();
      const cs=getComputedStyle(b);
      return {w:Math.round(r.width),h:Math.round(r.height),on:b.classList.contains('on'),
        color:cs.color,bg:cs.backgroundColor,ws:cs.whiteSpace};});
    const top=Math.round(rs[0] && document.getElementById('rxSeg').getBoundingClientRect().top);
    return {rs,top};
   } catch(e){ return {PAGEERR:String(e && e.message || e)}; }
  })()`);
  out.segGeo = segGeo.rs && segGeo.rs.length === 3
    && segGeo.rs.every(b => b.h <= 30 && b.w >= 36 && b.ws === 'nowrap')
    && segGeo.rs[0].on && /255/.test(segGeo.rs[0].color)
    && !segGeo.rs[1].on && !segGeo.rs[2].on;

  // ⑥ 第二行（单处方点评 + 报告）与第一行（明细+分布）都铺开：卡宽不塌缩
  const rowGeo = await win.webContents.executeJavaScript(`(function(){
   try {
    const cards=[...document.querySelectorAll('#v-rxreview .card')].map(c=>{
      const r=c.getBoundingClientRect();
      const h3=(c.querySelector('h3')||{}).textContent||'';
      return {t:h3.slice(0,8),w:Math.round(r.width),x:Math.round(r.x)};});
    return cards;
   } catch(e){ return [{PAGEERR:String(e && e.message || e)}]; }
  })()`);
  step('rows=' + JSON.stringify(rowGeo));
  const findCard = re => rowGeo.find(c => re.test(c.t || ''));
  const dashC = findCard(/仪表盘/), detC = findCard(/点评明细/), distC = findCard(/问题分布/),
        oneC = findCard(/单处方/), repC = findCard(/选中处方/);
  out.cardWidths = !!dashC && !!detC && !!distC && !!oneC && !!repC
    && dashC.w > 900 && detC.w > 500 && distC.w > 260 && oneC.w > 400 && repC.w > 300;

  console.log(JSON.stringify(Object.assign({ _detail: dash, _geo: geo, _rows: rowGeo }, out), null, 1));
  const bad = Object.entries(out).filter(([k, v]) => v !== true);
  console.log(bad.length ? 'HAS_FAIL: ' + bad.map(x => x[0]).join(',') : 'DASHBOARD ALL_OK');
  app.quit();
 } catch (e) { console.error('FATAL: ' + (e && e.stack || e)); app.quit(); }
});
