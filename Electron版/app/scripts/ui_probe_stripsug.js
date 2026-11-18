// 探针：后台两块新交互 —— ①AI 设置「自动推荐清理规则」（上传处方图/从文本推荐 → 勾选 → 加入清单）
//                        ②备份页「程序目录镜像备份」（状态显示 + 立即备份并镜像）
// 说明：admin:strip-suggest / backup:mirror-info / backup:mirror-now 走**真实实现**（主进程里 require
//      lib/stripsuggest、lib/backup），只有「上传图片 → 视觉模型」那条（要联网）不做端到端，仅验按钮存在。
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
const SHOT_DIR = path.join(__dirname, '..', '.probe', 'ui');
fs.mkdirSync(SHOT_DIR, { recursive: true });

// admin.html 依赖的 IPC 最小集
ipcMain.handle('ai:config-get', () => ({ models: [] }));
ipcMain.handle('panel:list', () => []);
for (const ch of ['ref:meta', 'ref:list', 'ref:search', 'sys:get', 'userkb:list', 'records:list', 'kb:list']) {
  try { ipcMain.handle(ch, () => (ch === 'ref:meta' ? [] : [])); } catch (e) { /* 已注册则忽略 */ }
}
// 真实实现：本地候选生成
ipcMain.handle('admin:strip-suggest', (e, { text, existing } = {}) => {
  try { return { ok: true, ...require('../lib/stripsuggest').suggest(text, existing || {}) }; }
  catch (err) { return { ok: false, error: err.message }; }
});
// 真实实现：镜像目录状态 / 立即备份并镜像
ipcMain.handle('backup:mirror-info', () => {
  try { return require('../lib/backup').mirrorInfo(); }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('backup:mirror-now', () => {
  try { return require('../lib/backup').mirrorNow(); }
  catch (err) { return { ok: false, error: err.message }; }
});

const SAMPLE = [
  '处方笺', '✓ 中医诊断：咳嗽', '1. 酒大黄 3g', '2. 黄芪 15g', '1克*1g/g',
  '(共14味7剂 每日1剂院内煎常规煎 分早晚两次饭后内服)', '共14味7剂', '—————',
  '打印时间：2026-10-17 10:22', '第 1 页', '其它', '其它',
].join('\n');

const CHECKS = [
  ['sugBtnExists', '「从当前文本推荐」按钮存在'],
  ['imgBtnExists', '「上传处方图片」按钮与 file input 存在'],
  ['candsShown', '点推荐 → 候选列表渲染出 ≥5 条'],
  ['candSafe', '候选里没有会删用法行的（无「用法/每日1剂」相关规则）'],
  ['addWorks', '勾选后「加入所选」→ 词进①②清单 / 正则进高级框'],
  ['advOpened', '加入正则后「高级」框自动展开'],
  ['mirrorCard', '备份页出现「程序目录镜像备份」卡片'],
  ['mirrorInfo', '镜像目录状态已渲染（路径可写 + 份数）'],
  ['mirrorNow', '点「立即备份并镜像」→ 返回成功并给出镜像路径'],
  // 新增：AI 设置二级页签（模型与连接 / 识别清理规则 / 问答测试）
  ['aiSubTabs', '二级页签 3 个（模型与连接 / 识别清理规则 / 问答测试）'],
  ['aiSubSwitch', '点「识别清理规则」→ 只显示该面板，其余隐藏'],
  ['aiSubAsk', '点「问答测试」→ 只显示问答卡片'],
  ['aiSubPersist', '切走再切回 AI 设置 → 停留在上次子页'],
];
const out = {};

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1360, height: 1700, show: true, // 必须可见：隐藏窗口 capturePage 几何不可靠
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true }
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'admin.html'));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await sleep(1200);

  // ---- AI 设置页 ----
  await win.webContents.executeJavaScript(`(async () => {
    const tabs = document.querySelectorAll('.tabs .tab');
    for (const t of tabs) if (/AI 设置/.test(t.textContent || '')) { t.click(); break; }
    return true;
  })()`);
  await sleep(800);

  out.sugBtnExists = await win.webContents.executeJavaScript(
    `(function(){ return [...document.querySelectorAll('#v-ai .btn')].some(b => /从当前文本推荐/.test(b.textContent)); })()`);
  out.imgBtnExists = await win.webContents.executeJavaScript(
    `(function(){ const b=[...document.querySelectorAll('#v-ai .btn')].some(x=>/上传处方图片/.test(x.textContent));
      return b && !!document.getElementById('stripImgFile'); })()`);

  await win.webContents.executeJavaScript(`(async () => {
    const el = document.getElementById('stripTestIn');
    el.value = ${JSON.stringify(SAMPLE)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const b = [...document.querySelectorAll('#v-ai .btn')].find(x => /从当前文本推荐/.test(x.textContent));
    b.click();
    return true;
  })()`);
  await sleep(900);

  const candState = await win.webContents.executeJavaScript(`(function(){
    const box = document.getElementById('stripCandList');
    const boxes = [...box.querySelectorAll('input[type=checkbox]')];
    // 只取规则本体（value）判安全 —— 说明文案里出现「用法」是正常的（例如「用法部分保留」）
    const vals = (typeof _stripCands !== 'undefined' ? _stripCands : []).map(c => String(c.value || ''));
    return { n: boxes.length, vals: vals.join('|') };
  })()`);
  out.candsShown = candState.n >= 5;
  // 安全守卫：候选规则本身绝不能去删用法行（用法/服法/每日1剂/分早晚/饭后/外用）
  out.candSafe = candState.n > 0 && !/用法|服法|每日\s*\d+\s*剂|分早晚|饭后|饭前|外用/.test(candState.vals);

  // 勾选全部 → 加入所选
  await win.webContents.executeJavaScript(`(async () => {
    document.querySelectorAll('#stripCandList input[type=checkbox]').forEach(c => { c.checked = true; });
    [...document.querySelectorAll('#v-ai .btn')].find(x => /加入所选/.test(x.textContent)).click();
    return true;
  })()`);
  await sleep(600);
  const after = await win.webContents.executeJavaScript(`(function(){
    const advEl = document.getElementById('aiStrip');
    // STRIP 是页面顶层 const（不是 window 属性），直接按词法作用域取
    return { drop: (typeof STRIP !== 'undefined' ? STRIP.drop.slice() : []),
             cut: (typeof STRIP !== 'undefined' ? STRIP.cut.slice() : []),
             adv: advEl ? advEl.value : '',
             advOpen: !!(document.getElementById('stripAdvBox')||{}).open,
             st: (document.getElementById('stripSugSt')||{}).textContent || '' };
  })()`);
  out.addWorks = (after.drop.length + after.cut.length) > 0 && /共|打印|页/.test(after.adv + after.drop.join() + after.cut.join());
  out.advOpened = after.advOpen === true && after.adv.length > 0;

  // ---- 二级页签 ----
  {
    const sub = await win.webContents.executeJavaScript(`(function(){
      const tabs=[...document.querySelectorAll('#v-ai .aisub .stab')];
      return { n: tabs.length, keys: tabs.map(t=>t.dataset.ai).join(','), on: tabs.filter(t=>t.classList.contains('on')).map(t=>t.dataset.ai).join(',') };
    })()`);
    out.aiSubTabs = sub.n === 3 && sub.keys === 'model,strip,ask' && sub.on === 'model';

    const disp = () => win.webContents.executeJavaScript(`(function(){
      const g = id => { const e=document.getElementById(id); return e ? getComputedStyle(e).display : 'missing'; };
      return { model:g('aip-model'), strip:g('aip-strip'), ask:g('aip-ask') };
    })()`);
    await win.webContents.executeJavaScript(
      `(function(){document.querySelector('#v-ai .aisub .stab[data-ai="strip"]').click();return true;})()`);
    await sleep(300);
    let d = await disp();
    out.aiSubSwitch = d.strip !== 'none' && d.model === 'none' && d.ask === 'none';

    await win.webContents.executeJavaScript(
      `(function(){document.querySelector('#v-ai .aisub .stab[data-ai="ask"]').click();return true;})()`);
    await sleep(300);
    d = await disp();
    out.aiSubAsk = d.ask !== 'none' && d.model === 'none' && d.strip === 'none';

    // 切到别的页签再回来 → 应仍在「问答测试」
    await win.webContents.executeJavaScript(`(async () => {
      for (const t of document.querySelectorAll('.tabs .tab')) if (/备份/.test(t.textContent||'')) { t.click(); break; }
      return true; })()`);
    await sleep(400);
    await win.webContents.executeJavaScript(`(async () => {
      for (const t of document.querySelectorAll('.tabs .tab')) if (/AI 设置/.test(t.textContent||'')) { t.click(); break; }
      return true; })()`);
    await sleep(600);
    d = await disp();
    out.aiSubPersist = d.ask !== 'none' && d.model === 'none';
  }

  // ---- 备份页 ----
  await win.webContents.executeJavaScript(`(async () => {
    const tabs = document.querySelectorAll('.tabs .tab');
    for (const t of tabs) if (/备份/.test(t.textContent || '')) { t.click(); break; }
    return true;
  })()`);
  await sleep(1200);
  const m1 = await win.webContents.executeJavaScript(`(function(){
    const el = document.getElementById('bkMirrorInfo');
    return { hasCard: /程序目录镜像备份/.test(document.body.textContent),
             txt: el ? el.textContent : '' };
  })()`);
  out.mirrorCard = m1.hasCard;
  out.mirrorInfo = /镜像目录/.test(m1.txt) && /可写/.test(m1.txt);

  const m2 = await win.webContents.executeJavaScript(`(async () => {
    [...document.querySelectorAll('#v-backup .btn')].find(x => /立即备份并镜像/.test(x.textContent)).click();
    await new Promise(r => setTimeout(r, 600));
    return (document.getElementById('bkSt4')||{}).textContent || '';
  })()`);
  await sleep(2500);
  const m3 = await win.webContents.executeJavaScript(`(function(){
    return { st: (document.getElementById('bkSt4')||{}).textContent || '',
             info: (document.getElementById('bkMirrorInfo')||{}).textContent || '' };
  })()`);
  out.mirrorNow = /已镜像到/.test(m3.st);

  // 截图取证：capturePage 在带 GPU 的沙箱进程里会偶发 UnknownVizError，
  // 必须容错——否则未捕获的 rejection 会让进程停在 app.exit 之前，表现为「探针挂住」。
  try {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(SHOT_DIR, 'admin-stripsug.png'), img.toPNG());
    console.log('[probe] 截图 → ' + path.join(SHOT_DIR, 'admin-stripsug.png'));
  } catch (e) { console.log('[probe] 截图跳过（' + (e && e.message) + '）'); }

  win.destroy();
  console.log('PROBE_JSON=' + JSON.stringify(out, null, 1));
  console.log('[diag] cands=' + candState.n + ' | after=' + JSON.stringify(after).slice(0, 300));
  console.log('[diag] mirror=' + m3.st.slice(0, 160) + ' || ' + m3.info.slice(0, 160));
  let ok = 0;
  console.log('\n———— 后台新交互探针 ————');
  CHECKS.forEach(([k, desc]) => {
    const pass = !!out[k];
    if (pass) ok++;
    console.log((pass ? '  OK  ' : ' FAIL ') + k + '  ' + desc);
  });
  console.log(`\n结果：${ok}/${CHECKS.length}` + (ok === CHECKS.length ? '  ALL_OK' : '  有失败项'));
  app.exit(0);
});
