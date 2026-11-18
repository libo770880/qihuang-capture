// 取证：面板「处方量化指标条」——味数 / 单剂g / 每日g / 剂数 / 天数 / 总计g / 最重
// 并验证：无剂数时天数置灰（不臆造）、超后台「点评红线」时标橙/红
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
app.disableHardwareAcceleration();
const OUT = path.join(__dirname, '..', '.probe', 'ui');
fs.mkdirSync(OUT, { recursive: true });

const TCM = require('../lib/tcm');
const RXQC = require('../lib/rxqc');
const COMP = require('../lib/compliance');

// 3 味（无缺项，避免轮17起的拦截态暂扣结论）：单剂 31g / 每日1剂 31g / 7 剂 → 7 天 / 总计 217g
const TEXT = '处方：\n黄芪 15g\n白术 10g\n茯苓 6g\n每日1剂 水煎服 分早晚两次饭后内服\n共3味7剂';
const USAGE = '每日1剂 水煎服 分早晚两次饭后内服';
const tcm = TCM.runTcm({ text: TEXT });
const qc = RXQC.check({ text: TEXT, tcm, usage: USAGE });
const REC = {
  id: 'mt-1', ts: '2026-10-18T03:00:00.000Z', source: 'region',
  text: TEXT, rawText: TEXT, keys: {},
  tcm, qc, compliance: COMP.runCompliance({ text: TEXT, keys: {} }),
  usage: USAGE, an: { auto: true, at: Date.now(), diag: '', synd: '' },
};
ipcMain.handle('panel:list', () => [REC]);
// 手填剂数（指标条「剂数」点击录入）：模拟后端 panel:patch 的 stat 重算语义
let patchCalls = [];
ipcMain.handle('panel:patch', (e, { id, patch } = {}) => {
  patchCalls.push(patch || {});
  const rec = JSON.parse(JSON.stringify(REC));
  if (patch && 'rxJi' in patch) {
    const v = Math.round(Number(patch.rxJi) || 0);
    const st = Object.assign({}, rec.tcm.rx.stat);
    const eff = v > 0 ? Math.min(v, 999) : 7;        // 0 = 回落原文自动识别（本样例原文「共3味7剂」）
    if (v > 0) st.jiManual = true; else delete st.jiManual;
    st.ji = eff; st.days = Math.round((eff / (st.dailyJi || 1)) * 100) / 100;
    st.totalG = Math.round((st.doseG || 0) * eff * 100) / 100;
    rec.rxJi = v > 0 ? v : undefined;
    rec.tcm = Object.assign({}, rec.tcm, { rx: Object.assign({}, rec.tcm.rx, { stat: st }) });
  }
  return { ok: true, rec };
});
ipcMain.handle('record:analyze', () => ({ ok: true, compliance: REC.compliance, tcm, qc, focusN: 0, hasRecord: true, tcmOk: true, msg: '分析完成' }));
// 红线：味数 提醒3/红线4（本方 4 味 → err）；天数 提醒5/红线7（7 天 → err）；供标色验证
ipcMain.handle('rxrule:get', () => ({
  ok: true, rules: { herbOn: true, herbWarn: 2, herbErr: 3, doseOn: true, doseWarn: 60, doseErr: 120,
    jiOn: true, jiWarn: 5, jiErr: 7, syndOn: true, syndRateWarn: 30, syndRateErr: 15, syndMiss: 'warn' },
}));
for (const ch of ['sys:get', 'ai:config-get', 'records:list', 'kb:list', 'ref:meta', 'ref:list', 'ref:search',
  'userkb:list', 'backup:mirror-info', 'ocr:config-get', 'yb:list', 'sbf:list', 'unm:list',
  'west:candidates', 'kb:stats', 'kb:yibao-list', 'kb:list-all']) {
  try { ipcMain.handle(ch, () => ({})); } catch (e) {}
}

const CHECKS = [
  ['barExists', '结果页出现指标条 .rxmt（位于「处方中药」之前）'],
  ['items', '指标项齐全：味数/单剂/每日/剂数/天数/总计/最重'],
  ['values', '数值正确：3 味 · 单剂 31g · 每日 31g · 7 剂 · 7 天 · 总计 217g'],
  ['maxHerb', '最重药味：黄芪 15g'],
  ['noJiNa', '无剂数时「剂数/天数」置灰显示 —（不臆造天数）'],
  ['redline', '超后台红线：味数 4（红线4）与天数 7（红线7）标红 .mi.err'],
  ['relaxed', '红线放宽后（味数红线 20 / 天数提醒 8）恢复中性配色'],
  ['jiEdit', '点击「剂数」就地录入 14 → panel:patch 落 rxJi，天数/总计随之重算（14 天 / 434g）'],
  ['jiClear', '清空剂数（回车）→ 回落原文自动识别 7 剂 / 7 天 / 217g'],
];
const sleep = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 2050, show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true } });
  win.webContents.on('console-message', (e, l, m) => { if (l >= 2) console.error('PAGE:', String(m).slice(0, 200)); });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'panel.html'));
  await sleep(1600);
  const out = {};

  out.barExists = await win.webContents.executeJavaScript(`(function(){
    const bar = document.getElementById('rxmt');
    if (!bar) return false;
    const secs = [...document.querySelectorAll('.tsec')];
    const herbSec = secs.find(x => /处方中药/.test(x.textContent||''));
    if (!herbSec) return false;
    return !!(bar.compareDocumentPosition(herbSec) & Node.DOCUMENT_POSITION_FOLLOWING);
  })()`);

  const dump = async () => win.webContents.executeJavaScript(`(function(){
    return [...document.querySelectorAll('#rxmt .mi')].map(x => ({
      t: (x.textContent||'').replace(/\\s+/g,'').trim(), cls: x.className, title: x.getAttribute('title')||'' }));
  })()`);
  let items = await dump();
  console.error('items=' + JSON.stringify(items).slice(0, 900));
  const txt = items.map(x => x.t).join('|');
  out.items = ['味数', '单剂', '每日', '剂数', '天数', '总计', '最重'].every(k => txt.includes(k));
  out.values = /味数3/.test(txt) && /单剂31g/.test(txt) && /每日31g/.test(txt)
    && /剂数7/.test(txt) && /天数7/.test(txt) && /总计217g/.test(txt);
  out.maxHerb = /最重黄芪15g/.test(txt);

  // 无剂数 → 剂数/天数 置灰（构造 stat 直接渲染，避免再造一条记录）
  const naTxt = await win.webContents.executeJavaScript(`(function(){
    const fake = { herbs: ['黄芪','白术','甘草'], rx: { stat: { herbN: 3, doseN: 3, noDoseN: 0,
      doseG: 30, dailyJi: 1, dailyG: 30, ji: 0, days: 0, totalG: 0, avgG: 10, maxG: 12, maxN: '黄芪' } } };
    const box = document.createElement('div'); box.innerHTML = rxMetricBarHtml(fake);
    return [...box.querySelectorAll('.mi')].map(x => (x.classList.contains('na') ? '[' + x.textContent.replace(/\\s+/g,'') + ']' : x.textContent.replace(/\\s+/g,''))).join('|');
  })()`);
  console.error('na=' + naTxt);
  out.noJiNa = /\[剂数—[^\]]*\]/.test(naTxt) && /\[天数—\]/.test(naTxt);

  // 红线标色：rxrule:get 的 mock 已给（味数 4≥4、天数 7≥7 → err）
  await win.webContents.executeJavaScript(`(function(){ rxRuleEnsure(); return true; })()`);
  await sleep(500);
  items = await dump();
  console.error('redline=' + JSON.stringify(items.map(x => x.cls + ':' + x.t)).slice(0, 600));
  const errItems = items.filter(x => /err/.test(x.cls));
  out.redline = errItems.length >= 2
    && errItems.some(x => /味数/.test(x.t)) && errItems.some(x => /天数/.test(x.t))
    && errItems.some(x => /超出红线/.test(x.title));

  // 放宽红线 → 恢复中性
  await win.webContents.executeJavaScript(`(function(){
    RX_RULE = { herbOn: true, herbWarn: 20, herbErr: 28, jiOn: true, jiWarn: 8, jiErr: 14 };
    rxMetricRefresh(); return true; })()`);
  await sleep(300);
  items = await dump();
  out.relaxed = items.length > 0 && items.every(x => !/err|warn/.test(x.cls));

  // ===== 剂数手填：点击指标条「剂数」→ 行内输入 → 回车落库并重算天数/总克 =====
  const jiOpen = await win.webContents.executeJavaScript(`(function(){
    const chip = document.getElementById('miJi'); if (!chip) return null;
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const i = document.getElementById('mij');
    return i ? { val: i.value, inChip: !!chip.querySelector('#mij') } : null;
  })()`);
  const jiSet = await win.webContents.executeJavaScript(`(function(){
    const i = document.getElementById('mij'); if (!i) return null;
    i.value = '14';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
  await sleep(600);
  const jiAfter = await dump();
  const jiTxt = jiAfter.map(x => x.t).join('|');
  console.error('jiOpen=' + JSON.stringify(jiOpen) + ' jiTxt=' + jiTxt + ' patches=' + JSON.stringify(patchCalls));
  out.jiEdit = !!jiOpen && jiOpen.val === '7' && jiOpen.inChip && jiSet === true
    && /剂数14/.test(jiTxt) && /天数14/.test(jiTxt) && /总计434g/.test(jiTxt)
    && patchCalls.some(p => Number(p.rxJi) === 14);

  // 清空 → 回落自动识别（原文「共3味7剂」→ 7 剂 / 7 天 / 217g）
  const jiClearSet = await win.webContents.executeJavaScript(`(function(){
    const chip = document.getElementById('miJi');
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const i = document.getElementById('mij'); if (!i) return false;
    i.value = '';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
  await sleep(600);
  const clearTxt = (await dump()).map(x => x.t).join('|');
  console.error('clearTxt=' + clearTxt);
  out.jiClear = jiClearSet === true && /剂数7/.test(clearTxt) && /天数7/.test(clearTxt) && /总计217g/.test(clearTxt)
    && patchCalls.some(p => Number(p.rxJi) === 0);

  try {
    // 用真实记录重渲一遍（避免 relaxed 阶段的临时规则残留在截图里），缩小整页进入视口后截图
    await win.webContents.executeJavaScript(`(function(){ anForceWb=false; renderAn(); return true; })()`);
    await sleep(800);
    await win.webContents.setZoomFactor(0.62);
    await win.webContents.executeJavaScript(`(function(){
      const bar=document.getElementById('rxmt');
      if(bar){ const m=document.querySelector('.main'); if(m) m.scrollTop = 0;
        bar.style.outline='2px solid #2f6a45'; bar.style.outlineOffset='2px'; }
      return true; })()`);
    await sleep(400);
    const img = await win.capturePage();
    fs.writeFileSync(path.join(OUT, 'rxmetric-panel2.png'), img.toPNG());
  } catch (e) { console.error('shot fail: ' + e.message); }

  let pass = 0;
  for (const [k, desc] of CHECKS) {
    const ok = !!out[k]; if (ok) pass++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${k.padEnd(10)} ${desc}`);
  }
  console.log(`${pass}/${CHECKS.length} ${pass === CHECKS.length ? 'ALL_OK' : 'HAS_FAIL'}`);
  app.quit();
  process.exit(pass === CHECKS.length ? 0 : 1);
});
