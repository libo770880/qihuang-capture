// 取证：面板「识别质检」——缺剂量/未入库药味红框标选 + 拦截分析 + 强制放行
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
app.disableHardwareAcceleration();
const OUT = path.join(__dirname, '..', '.probe', 'ui');
fs.mkdirSync(OUT, { recursive: true });

const TCM = require('../lib/tcm');
const RXQC = require('../lib/rxqc');
const COMP = require('../lib/compliance');

// 处方：党参缺剂量（error→拦截）、麒麟蝎未入库（error→拦截）；用法齐全（不触发缺用法）
const TEXT = '处方：\n黄芪 15g\n党参\n白术 10g\n麒麟蝎 6g\n每日1剂 水煎服 分早晚两次饭后内服';
const USAGE = '每日1剂 水煎服 分早晚两次饭后内服';
const tcm = TCM.runTcm({ text: TEXT });
const qc = RXQC.check({ text: TEXT, tcm, usage: USAGE });
// 库比对（subs）：模拟 tcm 输出的识别名≠库规范名（白术→苍术 替换示例），验证橙色「校」标与提示条「库比对」行
qc.subs = [{ raw: '白术', canon: '苍术', fuzzy: false }];
const REC = {
  id: 'qc-1', ts: '2026-10-18T02:00:00.000Z', source: 'region',
  text: TEXT, rawText: TEXT, keys: { '中医诊断': '乳岩', '西医诊断': '肿瘤' },
  sections: [{ type: 'other', content: TEXT }],   // maskedView 下的分块（真实记录由采集侧产出）
  tcm, qc, compliance: COMP.runCompliance({ text: TEXT, keys: {} }),
  usage: USAGE, an: { auto: true, at: Date.now(), diag: '', synd: '' },
};
let analyzeCalls = [];
let patchCalls = [];
ipcMain.handle('panel:list', () => [REC]);
ipcMain.handle('panel:patch', (e, a) => {
  const { id, patch } = a || {};
  patchCalls.push({ id, keys: patch && patch.keys ? JSON.parse(JSON.stringify(patch.keys)) : null });
  if (patch && patch.keys) REC.keys = Object.assign({}, REC.keys, patch.keys);
  return { ok: true, rec: REC };
});
// 药味映射（HERB_MAP）：处方块判定依赖 kb:list-all；空库会让「处方（可编辑）」网格不渲染
try { ipcMain.handle('kb:list-all', () => ({ herbs: [{ n: '黄芪' }, { n: '党参' }, { n: '白术' }, { n: '麒麟蝎' }] })); } catch (e) {}
ipcMain.handle('record:analyze', (e, a) => {
  analyzeCalls.push({ id: a && a.id, force: a && a.force, reason: (a && a.reason) || '' });
  // 与 main.js 同构：强制且带理由 → qc.forced 留痕返回
  const qcRet = (a && a.force) ? Object.assign({}, qc, { forced: { at: new Date().toISOString(), reason: (a && a.reason) || '' } }) : qc;
  return { ok: true, compliance: REC.compliance, tcm, qc: qcRet, focusN: 0, hasRecord: true, tcmOk: true, msg: '分析完成' };
});
for (const ch of ['sys:get', 'ai:config-get', 'records:list', 'kb:list', 'ref:meta', 'ref:list', 'ref:search',
  'userkb:list', 'backup:mirror-info', 'ocr:config-get', 'rxrule:get', 'yb:list', 'sbf:list', 'unm:list',
  'west:candidates', 'kb:stats', 'kb:yibao-list', 'kb:list-all']) {
  try { ipcMain.handle(ch, () => ({})); } catch (e) {}
}

const CHECKS = [
  ['qcBlocked', '质检判定：党参缺剂量 + 麒麟蝎未入库 → block=true、errN=2'],
  ['badChips', '面板中药卡片：问题药味红框（.hchip.bad），含「党参」'],
  ['unknownChip', '未入库药名单独红框列出（麒麟蝎 · 未入库）'],
  ['qcBar', '结果页顶部拦截条 .qcbar：含「已拦截分析」与待修正药味清单'],
  ['forceBtn', '拦截条上有「强制分析」按钮'],
  ['holdPage', '拦截态：分析结论暂扣（.qchold 出现、.tcm 合规分析不渲染）'],
  ['rxBadRows', '处方可编辑网格：缺剂量药味行红框（.rxrow.bad）+「缺剂量」角标'],
  ['analyzeBlocked', '点「本地分析」被拦截：不调用 record:analyze'],
  ['reasonRequired', '强制不填理由点「确认强制」：不放行（不调用 analyze）'],
  ['forceRun', '填理由确认强制：调用 analyze 且 force=1、reason 留痕'],
  ['forcedBar', '放行后黄条「已强制放行」+ 理由，分析结论恢复展示（.tcm 出现）'],
  ['goodChip', '正常药味（黄芪/白术）不带红框'],
  ['qcLocLink', '拦截条「待修正药味」药味名可点击定位（.qclink）'],
  ['autoLocate', '打开记录自动定位第一个问题药味行（.rxrow.flash）'],
  ['locateClick', '点击药味名定位：滚动到问题行 + 缺剂量时聚焦剂量输入框'],
  ['autoAddRow', '点击网格中不存在的药味（白花蛇舌草）：自动补录一行并聚焦剂量框'],
  ['keyEdit', '诊断胶囊可编辑：点击值→行内输入框，回车保存落库并同步 cur.diag'],
  ['qcRowFill', '质检检出但原文处方中无行的药味：自动补录进网格（「补」角标），无需手动点击'],
  ['forcedBadge', '侧栏记录卡「已强制」标 + 悬停可见理由（留痕可查）'],
  ['subRow', '库比对：识别名≠库规范名 → 橙色虚线「校」标（不红框、不拦截）+ 提示条「库比对」行'],
];
const sleep = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 1100, show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true } });
  win.webContents.on('console-message', (e, l, m) => { if (l >= 2) console.error('PAGE:', String(m).slice(0, 200)); });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'panel.html'));
  await sleep(1500);
  const out = {};
  out.qcBlocked = qc.block === true && qc.errN === 2;

  const dom = await win.webContents.executeJavaScript(`(function(){
    try {
      const bad = [...document.querySelectorAll('.hchip.bad')].map(x => ({
        t: (x.textContent||'').trim(), title: x.getAttribute('title') || '' }));
      const bar = document.querySelector('.qcbar');
      const btns = [...document.querySelectorAll('.qcbar .qcbtn')].map(x => x.textContent.trim());
      const all = [...document.querySelectorAll('.hchip')].map(x => ({
        t: (x.textContent||'').trim(), bad: x.classList.contains('bad') }));
      const hold = document.querySelector('.qchold');
      const tcmCard = document.querySelector('.tcm');
      const rxbad = [...document.querySelectorAll('#rxGrid .rxrow.bad')].map(x => x.textContent.replace(/\\s+/g,''));
      return { bad, all, bar: bar ? bar.textContent.replace(/\\s+/g,' ').trim() : '',
        btns, barCls: bar ? bar.className : '',
        hold: hold ? hold.textContent.replace(/\\s+/g,' ') : '',
        hasTcm: !!tcmCard, rxbad, rxBlocks: !!document.getElementById('rxBlocks'), rxGrid: !!document.getElementById('rxGrid'), gridN: document.querySelectorAll('#rxGrid .rxrow').length, hm: typeof HERB_MAP !== 'undefined' ? Object.keys(HERB_MAP||{}).length : 'undef', secs: (typeof inferSections==='function'&&cur)?inferSections(cur.rawText||cur.text).length:-1 };
    } catch (e) { return { PAGEERR: String(e && e.message || e) }; }
  })()`);
  console.error('dom=' + JSON.stringify(dom).slice(0, 900));
  out.qcBar = /已拦截分析/.test(dom.bar || '') && /待修正药味/.test(dom.bar || '') && !/warn/.test(dom.barCls || '');
  out.forceBtn = (dom.btns || []).includes('强制分析') && (dom.btns || []).includes('确认强制');
  out.holdPage = /分析结论已暂扣/.test(dom.hold || '') && dom.hasTcm === false;
  out.rxBadRows = (dom.rxbad || []).length >= 1 && (dom.rxbad || []).some(x => /缺剂量/.test(x));

  // 定位：拦截条药味名可点击（.qclink）+ 打开记录自动定位第一个问题行（flash）+ 点击聚焦剂量框
  const domL = await win.webContents.executeJavaScript(`(function(){
    try {
      const links=[...document.querySelectorAll('.qcbar .qclink')].map(x=>x.textContent.trim());
      const flashRows=[...document.querySelectorAll('#rxGrid .rxrow.flash')].map(x=>{
        const i=x.querySelector('.rxn'); return (i&&i.value||'').trim()+'|'+x.textContent.replace(/\\s+/g,''); });
      return { links, flashRows, hasFn: typeof rxLocate==='function' };
    } catch(e){ return { PAGEERR: String(e&&e.message||e) }; }
  })()`);
  console.error('domL=' + JSON.stringify(domL).slice(0, 300));
  out.qcLocLink = domL.hasFn === true && (domL.links || []).includes('党参');
  out.autoLocate = (domL.flashRows || []).length >= 1 && /党参/.test(domL.flashRows.join('|'));
  await win.webContents.executeJavaScript(`(function(){ const a=[...document.querySelectorAll('.qcbar .qclink')].find(x=>x.textContent.trim()==='党参'); if(a) a.click(); return !!a; })()`);
  await sleep(900);
  const focused = await win.webContents.executeJavaScript(`(function(){
    const ae=document.activeElement; return ae&&ae.classList?String(ae.className)+'|'+(ae.value||''):'none'; })()`);
  out.locateClick = /^rxd/.test(focused || '');

  // 网格中不存在的药味（白花蛇舌草）→ 显式点击自动补录一行（药名带入、剂量空）并聚焦剂量框
  const rowsBefore = await win.webContents.executeJavaScript(`RXE.rows.length`);
  await win.webContents.executeJavaScript(`(function(){ rxLocate('白花蛇舌草', true, true); return true; })()`);
  await sleep(700);
  const added = await win.webContents.executeJavaScript(`(function(){
    const row=RXE.rows.find(r=>r.name==='白花蛇舌草');
    const ae=document.activeElement;
    return { n: RXE.rows.length, hasRow: !!row, doseEmpty: row?String(row.dose||'').trim()==='' : null,
             focused: ae&&ae.classList?String(ae.className):'none', dirty: RXE.dirty }; })()`);
  out.autoAddRow = added.n === rowsBefore + 1 && added.hasRow === true && added.doseEmpty === true
    && /^rxd/.test(added.focused || '') && added.dirty === true;

  // 库比对（subs）：白术行橙色虚线 + 「校」标（非红框）；拦截条含「库比对」行
  const domS = await win.webContents.executeJavaScript(`(function(){
    const row=[...document.querySelectorAll('#rxGrid .rxrow')].find(x=>{const i=x.querySelector('.rxn');return i&&i.value==='白术';});
    const bar=document.querySelector('.qcbar');
    return { subst: row?row.classList.contains('subst'):null, badge: row?!!row.querySelector('.rxsub'):null,
      bad: row?row.classList.contains('bad'):null, barSub: bar?/库比对/.test(bar.textContent):false };
  })()`);
  out.subRow = domS.subst === true && domS.badge === true && domS.bad === false && domS.barSub === true;
  if (!out.subRow) console.error('subRow dbg: ' + JSON.stringify(domS));

  // 诊断胶囊可编辑：点击「中医诊断」值 → 行内输入框 → 改值回车 → panel:patch keys 落库 + cur.diag 同步
  const kvCount = await win.webContents.executeJavaScript(`document.querySelectorAll('.keys .k .kv').length`);
  await win.webContents.executeJavaScript(`(function(){ const els=[...document.querySelectorAll('.keys .k')]; const el=els.find(x=>x.querySelector('b').textContent==='中医诊断'); el&&el.querySelector('.kv').click(); return !!el; })()`);
  await sleep(300);
  const editing = await win.webContents.executeJavaScript(`(function(){ const i=document.querySelector('.kvedit'); if(!i) return false; i.value='乳岩病'; i.dispatchEvent(new Event('blur')); return true; })()`);
  await sleep(700);
  const keyState = await win.webContents.executeJavaScript(`(function(){ return { k: (cur.keys&&cur.keys['中医诊断'])||'', diag: cur.diag||'', hasApi: typeof (window.qhjf&&window.qhjf.patchRecord) }; })()`);
  out.keyEdit = kvCount >= 2 && editing === true
    && keyState.k === '乳岩病' && keyState.diag === '乳岩病'
    && (patchCalls || []).some(p => p.keys && p.keys['中医诊断'] === '乳岩病');
  if (!out.keyEdit) console.error('keyEdit dbg: kv=' + kvCount + ' edit=' + editing + ' state=' + JSON.stringify(keyState) + ' patches=' + JSON.stringify(patchCalls));

  // 质检药味自动进网格：模拟原文缺行（删掉麒麟蝎行）→ rxEnsureQcRows 自动补回（added 标 + 「补」角标）
  const filled = await win.webContents.executeJavaScript(`(function(){
    const before=RXE.rows.length;
    RXE.rows=RXE.rows.filter(r=>r.name!=='麒麟蝎');
    const removed=before-RXE.rows.length;
    rxEnsureQcRows();
    const row=RXE.rows.find(r=>r.name==='麒麟蝎');
    renderRxGrid();
    const badge=!!document.querySelector('#rxGrid .rxadd');
    return { removed, restored: !!row, added: !!(row&&row.added), badge };
  })()`);
  out.qcRowFill = filled.removed === 1 && filled.restored === true && filled.added === true
    && (filled.badge || /麒麟蝎/.test((await win.webContents.executeJavaScript(`[...document.querySelectorAll('#rxGrid .rxrow.bad .rxn')].map(x=>x.value).join('|')`)) || ''));

  // 拦截：切到工作台（anForceWb=true）后点「本地分析」→ 不应调用 analyze
  await win.webContents.executeJavaScript(`(function(){ anForceWb = true; renderAn(); return true; })()`);
  await sleep(400);
  await win.webContents.executeJavaScript(`(function(){ const b=document.getElementById('wbRun'); if(b) b.click(); return !!b; })()`);
  await sleep(600);
  out.analyzeBlocked = analyzeCalls.length === 0;

  // 强制（两步）：「强制分析」展开理由行 → 空理由点「确认强制」不放行 → 填理由后放行
  await win.webContents.executeJavaScript(`(function(){ anForceWb = false; renderAn(); return true; })()`);
  await sleep(400);
  await win.webContents.executeJavaScript(`(function(){ const b=[...document.querySelectorAll('.qcbar .qcbtn')].find(x=>x.textContent==='强制分析'); if(b) b.click(); return !!b; })()`);
  await sleep(300);
  await win.webContents.executeJavaScript(`(function(){ const b=[...document.querySelectorAll('.qcbar .qcbtn')].find(x=>x.textContent==='确认强制'); if(b) b.click(); return !!b; })()`);
  await sleep(500);
  out.reasonRequired = analyzeCalls.length === 0;
  await win.webContents.executeJavaScript(`(function(){ const i=document.getElementById('qcfReason'); if(i) i.value='医师复核确认：缺剂量药味为抄录省略，剂量按原方执行'; return true; })()`);
  await win.webContents.executeJavaScript(`(function(){ const b=[...document.querySelectorAll('.qcbar .qcbtn')].find(x=>x.textContent==='确认强制'); if(b) b.click(); return !!b; })()`);
  await sleep(900);
  out.forceRun = analyzeCalls.length === 1 && String(analyzeCalls[0].force) === '1'
    && /抄录省略/.test(analyzeCalls[0].reason || '');

  // 放行后：黄条「已强制放行」+ 理由；分析结论恢复展示
  const dom2 = await win.webContents.executeJavaScript(`(function(){
    const bar = document.querySelector('.qcbar');
    return { barCls: bar ? bar.className : '', bar: bar ? bar.textContent.replace(/\\s+/g,' ') : '',
      hasTcm: !!document.querySelector('.tcm') };
  })()`);
  console.error('dom2=' + JSON.stringify(dom2).slice(0, 400));
  out.forcedBar = /forced/.test(dom2.barCls || '') && /已强制放行/.test(dom2.bar || '')
    && /抄录省略/.test(dom2.bar || '') && dom2.hasTcm === true;

  // 留痕可查：侧栏记录卡出现「已强制」标，悬停 title 即理由（强制后立即刷新，无需重开记录）
  const domF = await win.webContents.executeJavaScript(`(function(){
    const b=document.querySelector('#list .tag.forced');
    return { has: !!b, title: b ? (b.getAttribute('title')||'') : '' };
  })()`);
  console.error('domF=' + JSON.stringify(domF).slice(0, 300));
  out.forcedBadge = domF.has === true && /抄录省略/.test(domF.title || '');

  // 放行后分析结论可见：中药胶囊红框标选（速览）与网格一致；麒麟蝎未入库单独列出
  const dom3 = await win.webContents.executeJavaScript(`(function(){
    const bad = [...document.querySelectorAll('.hchip.bad')].map(x => ({
      t: (x.textContent||'').trim(), title: x.getAttribute('title') || '' }));
    const all = [...document.querySelectorAll('.hchip')].map(x => ({ t: (x.textContent||'').trim(), bad: x.classList.contains('bad') }));
    return { bad, all };
  })()`);
  const badTxt = (dom3.bad || []).map(x => x.t).join('|');
  out.badChips = (dom3.bad || []).length >= 1 && /党参/.test(badTxt) && (dom3.bad || []).some(x => /缺剂量/.test(x.title));
  out.unknownChip = /麒麟蝎/.test(badTxt) && /未入库/.test(badTxt);
  out.goodChip = (dom3.all || []).filter(x => /黄芪|白术/.test(x.t)).length >= 2
    && (dom3.all || []).filter(x => /黄芪|白术/.test(x.t)).every(x => !x.bad);

  try {
    await win.webContents.executeJavaScript(`(function(){
      anForceWb=false; renderAn();
      const bar=document.querySelector('.qcbar'); if(bar) bar.scrollIntoView({block:'start'});
      return true; })()`);
    await sleep(600);
    const img = await win.capturePage();
    fs.writeFileSync(path.join(OUT, 'qc-panel.png'), img.toPNG());
  } catch (e) { console.error('shot fail: ' + e.message); }

  let pass = 0;
  for (const [k, desc] of CHECKS) {
    const ok = !!out[k]; if (ok) pass++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${k.padEnd(15)} ${desc}`);
  }
  console.log('analyzeCalls=' + JSON.stringify(analyzeCalls));
  console.log(`${pass}/${CHECKS.length} ${pass === CHECKS.length ? 'ALL_OK' : 'HAS_FAIL'}`);
  app.quit();
  process.exit(pass === CHECKS.length ? 0 : 1);
});
