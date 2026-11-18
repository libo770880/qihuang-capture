// 取证：科室维度（2026-10-19）
//   ① 侧栏记录卡显示科室标签 + 科室下拉筛选（含「未标注科室」）
//   ② 详情页头部「科室 ✎」可编辑（datalist 建议 + panel:patch 落库）
//   ③ 数据看板：科室胶囊筛选 + 覆盖科室指标 + 科室分布（点行下钻）
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
app.disableHardwareAcceleration();
const OUT = path.join(__dirname, '..', '.probe', 'ui');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const mk = (id, dept, diag, synd, ago) => ({
  id, ts: new Date(Date.now() - ago).toISOString(), source: 'region',
  text: `处方笺\n科室：${dept || ''}\n诊断：${diag}`, rawText: '', keys: { '中医诊断': diag },
  sections: [], diag, synd, dept, patient: '', usage: '每日1剂 水煎服',
  compliance: { ok: true, grade: '合规', items: [] },
});
const R1 = mk('dp-1', '脾胃病科', '胃脘痛', '脾胃虚寒证', 2 * 3600e3);
const R2 = mk('dp-2', '骨伤科', '骨折病', '气滞血瘀证', 26 * 3600e3);
const R3 = mk('dp-3', '', '不寐', '心脾两虚证', 50 * 3600e3);
let RECS = [R1, R2, R3];
const patchCalls = [];

ipcMain.handle('panel:list', () => RECS);
ipcMain.handle('panel:patch', (e, a) => {
  const { id, patch } = a || {};
  patchCalls.push({ id, dept: patch && patch.dept });
  const r = RECS.find(x => x.id === id);
  if (r && patch && typeof patch.dept === 'string') r.dept = patch.dept;
  return { ok: true, rec: r };
});
for (const ch of ['sys:get', 'ai:config-get', 'kb:list-all', 'kb:list', 'kb:stats', 'yb:list', 'sbf:list',
  'unm:list', 'west:candidates', 'ref:meta', 'ref:list', 'ref:search', 'userkb:list',
  'backup:mirror-info', 'ocr:config-get', 'rxrule:get', 'clinical:stats', 'clinical:list']) {
  try { ipcMain.handle(ch, () => ({})); } catch (e) {}
}

const CHECKS = [];
function check(k, ok, note) { CHECKS.push({ k, ok: !!ok, note: note === undefined ? '' : String(note) }); }

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1200, height: 860, show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true } });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'panel.html'));
  await sleep(1600);
  const js = async (code) => {
    try { return await win.webContents.executeJavaScript(code); }
    catch (e) { return 'ERR:' + String(e && e.message || e).slice(0, 160); }
  };

  // ① 侧栏
  const opts = await js(`[...document.querySelectorAll('#deptSel option')].map(o=>o.value+'|'+o.textContent)`);
  check('deptSelect', Array.isArray(opts) && opts.some(x => x.startsWith('脾胃病科')) && opts.some(x => x.startsWith('骨伤科')) && opts.some(x => x.startsWith('__none')), JSON.stringify(opts));

  const tags = await js(`[...document.querySelectorAll('#list .tag.dept')].map(e=>e.textContent)`);
  check('deptTag', tags.includes('脾胃病科') && tags.includes('骨伤科'), JSON.stringify(tags));

  const allN = await js(`document.querySelectorAll('#list .rec').length`);
  check('listAll', allN === 3, 'n=' + allN);

  const filtered = await js(`(function(){document.getElementById('deptSel').value='骨伤科';document.getElementById('deptSel').dispatchEvent(new Event('change'));return 1;})()`);
  await sleep(250);
  const fN = await js(`document.querySelectorAll('#list .rec').length`);
  const fTxt = await js(`[...document.querySelectorAll('#list .rec')].map(e=>e.querySelector('.tag.dept')?e.querySelector('.tag.dept').textContent:'').join(',')`);
  check('deptFilter', filtered === 1 && fN === 1 && fTxt === '骨伤科', 'n=' + fN + ' tags=' + fTxt);

  const noneN = await js(`(function(){const s=document.getElementById('deptSel');s.value='__none';s.dispatchEvent(new Event('change'));return document.querySelectorAll('#list .rec').length;})()`);
  await sleep(200);
  check('deptNone', noneN === 1, 'n=' + noneN);

  await js(`(function(){const s=document.getElementById('deptSel');s.value='all';s.dispatchEvent(new Event('change'));return 1;})()`);
  await sleep(200);

  // ② 详情头部科室 + 编辑弹窗
  await js(`(function(){const el=[...document.querySelectorAll('#list .rec')].find(e=>e.dataset.id==='dp-1');if(el)el.click();return 1;})()`);
  await sleep(400);
  const headTxt = await js(`document.querySelector('.dhead .dm').textContent`);
  check('deptHead', /科室\s*脾胃病科/.test(headTxt), headTxt.slice(0, 120));

  await js(`editDept()`);
  await sleep(250);
  const modal = await js(`!!document.getElementById('dpInput') && [...document.querySelectorAll('#dpList option')].map(o=>o.value).join(',')`);
  check('deptModal', typeof modal === 'string' && modal.indexOf('骨伤科') >= 0, modal);

  const saved = await js(`(function(){document.getElementById('dpInput').value='脑病科';saveDept();return 1;})()`);
  await sleep(400);
  const call = patchCalls[patchCalls.length - 1] || {};
  const head2 = await js(`document.querySelector('.dhead .dm').textContent`);
  check('deptSave', saved === 1 && call.dept === '脑病科' && /脑病科/.test(head2), JSON.stringify(call));

  // ③ 数据看板
  await js(`showDash()`);
  await sleep(500);
  const chips = await js(`[...document.querySelectorAll('.dchips .fchip')].map(b=>b.textContent.trim())`);
  check('dashChips', Array.isArray(chips) && chips.length >= 3 && chips[0].indexOf('全部科室') === 0, JSON.stringify(chips));

  // dp-1 已改成脑病科：去重后 2 个科室、0 位已标注患者
  const metricAll = await js(`document.querySelectorAll('.db-metric')[2].querySelector('.v').textContent.replace(/\s+/g,' ').trim()`);
  check('dashDeptMetric', /^2\s*\/\s*0$/.test(metricAll), metricAll);

  const dist = await js(`[...document.querySelectorAll('.db-deptrow .db-k')].map(e=>e.textContent)`);
  check('dashDeptDist', dist.includes('脾胃病科') && dist.includes('（未标注）'), JSON.stringify(dist));

  const afterPick = await js(`(function(){const el=[...document.querySelectorAll('.db-deptrow')].find(e=>e.dataset.d==='骨伤科');if(!el)return 'no-row';el.click();return 1;})()`);
  await sleep(400);
  const totalAfter = await js(`document.querySelectorAll('.db-metric')[0].querySelector('.v').textContent.trim()`);
  const chipOn = await js(`[...document.querySelectorAll('.dchips .fchip.on')].map(b=>b.dataset.d).join(',')`);
  check('dashPick', afterPick === 1 && totalAfter === '1' && chipOn === '骨伤科', 'total=' + totalAfter + ' chip=' + chipOn);

  const img = await win.capturePage();
  fs.writeFileSync(path.join(OUT, 'dept-dashboard.png'), img.toPNG());

  const passN = CHECKS.filter(c => c.ok).length;
  for (const c of CHECKS) console.log((c.ok ? '[PASS] ' : '[FAIL] ') + c.k + (c.note ? '  ' + c.note : ''));
  console.log(`dept ${passN}/${CHECKS.length} ${passN === CHECKS.length ? 'ALL_OK' : 'HAS_FAIL'}`);
  app.exit(passN === CHECKS.length ? 0 : 1);
});
