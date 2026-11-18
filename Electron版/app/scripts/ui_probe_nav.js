// 探针：后台左侧竖排导航 —— 分组折叠 / 顶栏主题色随分组联动 / 布局不塌
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
const SHOT_DIR = path.join(__dirname, '..', '.probe', 'ui');
fs.mkdirSync(SHOT_DIR, { recursive: true });

for (const ch of ['ai:config-get', 'panel:list', 'ref:meta', 'ref:list', 'ref:search', 'sys:get',
  'userkb:list', 'records:list', 'kb:list', 'rxrule:get', 'yb:list', 'sbf:list', 'unm:list',
  'backup:info', 'ocr:config-get', 'log:read', 'ocrfix:list', 'kb:stats', 'kb:yibao-list']) {
  try { ipcMain.handle(ch, () => ({})); } catch (e) { /* 已注册则忽略 */ }
}

const CHECKS = [
  ['navRendered', '左侧导航渲染 6 个分组 / 17 个菜单项'],
  ['navVertical', '导航竖排在左侧（列向、宽约 180px、位于顶栏下方）'],
  ['viewRight', '内容区在导航右侧且铺满剩余宽度（不与导航重叠）'],
  ['grpCollapse', '点组头折叠：子项隐藏 + 箭头旋转'],
  ['grpExpand', '再点组头展开：子项恢复显示'],
  ['grpPersist', '折叠状态写入 localStorage（刷新后保持）'],
  ['themeKb', '选「方剂库」→ 顶栏主色 = 知识库绿 #1d6f4b'],
  ['themeRule', '选「点评红线」→ 顶栏主色 = 审方红 #bf3a2f'],
  ['themeAi', '选「AI 设置」→ 顶栏主色 = AI 紫 #6a5cb0'],
  ['themeGrpCur', '当前分组头高亮（cur 类与本组色一致）'],
  ['autoExpand', '折叠某组后切到组内页面 → 自动展开'],
  ['itemOnColor', '选中项用本组色（左边框 + 浅底）'],
  ['rxviewHidden', '非激活页签时点评页隐藏（display:none，不得叠到其它页面右侧）'],
  ['rxviewShown', '切到点评页 → display:block；切走 → 恢复 none'],
];
const out = {};

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true }
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'admin.html'));
  const r = await win.webContents.executeJavaScript(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const r = {};
    // 离屏窗口不推进 CSS 过渡，读到的是动画起点色 —— 断言前统一关闭过渡/动画
    const noAnim = document.createElement('style');
    noAnim.textContent = '*,*::before,*::after{transition:none !important;animation:none !important}';
    document.head.appendChild(noAnim);
    await sleep(900);
    const nav = document.getElementById('adnav');
    const grps = [...document.querySelectorAll('.navgrp')];
    const items = [...document.querySelectorAll('.navgrp .tab')];
    r.grpN = grps.length; r.itemN = items.length;
    r.navRendered = grps.length === 6 && items.length === 17;

    const nb = nav.getBoundingClientRect();
    const cs = getComputedStyle(nav);
    r.navBox = { x: Math.round(nb.x), y: Math.round(nb.y), w: Math.round(nb.width), h: Math.round(nb.height) };
    r.navVertical = cs.flexDirection === 'column' && nb.width >= 150 && nb.width <= 200
      && nb.x < 10 && nb.y >= 50 && nb.y < 70 && nb.height > 300;

    const vw = document.querySelector('.view.on');
    const vb = vw ? vw.getBoundingClientRect() : null;
    r.viewBox = vb ? { x: Math.round(vb.x), w: Math.round(vb.width) } : null;
    r.viewRight = !!vb && vb.x >= nb.right - 1 && vb.width > 900;

    // 折叠：知识库组
    const kb = document.querySelector('.navgrp[data-g="kb"]');
    const kbi = kb.querySelector('.navitems');
    const caret = kb.querySelector('.caret');
    r.beforeDisp = getComputedStyle(kbi).display;
    kb.querySelector('.navgrphd').click(); await sleep(220);
    r.afterDisp = getComputedStyle(kbi).display;
    r.caretTf = getComputedStyle(caret).transform;
    r.grpCollapse = r.afterDisp === 'none' && /matrix/.test(r.caretTf) && r.caretTf !== 'none';
    r.persistVal = localStorage.getItem('qhjf.admin.nav.collapsed');
    r.grpPersist = /"kb"/.test(r.persistVal || '');
    kb.querySelector('.navgrphd').click(); await sleep(220);
    r.reDisp = getComputedStyle(kbi).display;
    r.grpExpand = r.reDisp === 'flex';

    // 主题色联动
    const topbar = () => getComputedStyle(document.querySelector('.top')).backgroundColor.trim();
    const hex2rgb = h => { const n = parseInt(h.slice(1), 16); return 'rgb(' + [(n>>16)&255,(n>>8)&255,n&255].join(', ') + ')'; };
    switchView('formulas'); await sleep(160);
    r.cKb = topbar(); r.themeKb = r.cKb === hex2rgb('#1d6f4b');
    switchView('rxrule'); await sleep(160);
    r.cRule = topbar(); r.themeRule = r.cRule === hex2rgb('#bf3a2f');
    switchView('ai'); await sleep(160);
    r.cAi = topbar(); r.themeAi = r.cAi === hex2rgb('#6a5cb0');
    r.dbgInline = document.documentElement.style.getPropertyValue('--topbar');
    r.dbgGcAi = getComputedStyle(document.querySelector('.navgrp[data-g=\"ai\"]')).getPropertyValue('--gc').trim();
    r.dbgTopVar = getComputedStyle(document.querySelector('.top')).getPropertyValue('--topbar').trim();
    r.dbgTopBg = getComputedStyle(document.querySelector('.top')).backgroundColor;
    const cur = document.querySelector('.navgrp.cur');
    r.curG = cur ? cur.dataset.g : '';
    r.themeGrpCur = r.curG === 'ai';
    const onItem = document.querySelector('.tab.on');
    const ocs = onItem ? getComputedStyle(onItem) : null;
    r.gcsVal = onItem ? getComputedStyle(onItem).getPropertyValue('--gcs').trim() : '';
    r.onItem = { v: onItem && onItem.dataset.v, bl: ocs && ocs.borderLeftColor, bg: ocs && ocs.backgroundColor };
    r.itemOnColor = !!ocs && ocs.borderLeftColor === hex2rgb('#6a5cb0') && ocs.backgroundColor === hex2rgb('#efecf8');

    // 自动展开：折叠 rule 组后切到 rxreview
    const rule = document.querySelector('.navgrp[data-g="rule"]');
    rule.querySelector('.navgrphd').click(); await sleep(160);
    r.ruleCollapsed = rule.classList.contains('collapsed');
    // 点评页显隐回归：非激活必须 none（ID 选择器若覆盖 .view{display:none} 会叠到所有页面右侧）
    // 注：admin.html 会恢复上次页签（共享 userData），若初始恰好激活 rxreview 则跳过该半边断言
    const curV0 = (document.querySelector('.tab.on') || {}).dataset?.v || '';
    const rxEl = document.getElementById('v-rxreview');
    r.rxDbg = { cur: curV0, disp: getComputedStyle(rxEl).display, cls: rxEl.className };
    r.rxviewHidden = curV0 === 'rxreview' ? true
      : getComputedStyle(rxEl).display === 'none';
    switchView('rxreview'); await sleep(160);
    r.autoExpand = !rule.classList.contains('collapsed')
      && getComputedStyle(rule.querySelector('.navitems')).display === 'flex';
    const rxOn = getComputedStyle(document.getElementById('v-rxreview')).display === 'block';
    switchView('formulas'); await sleep(160);
    r.rxviewShown = rxOn && getComputedStyle(document.getElementById('v-rxreview')).display === 'none';
    return r;
  })()`);
  Object.assign(out, r);
  await win.capturePage().then(img => fs.writeFileSync(path.join(SHOT_DIR, 'nav-admin.png'), img.toPNG()));

  let pass = 0;
  const lines = CHECKS.map(([k, desc]) => {
    const ok = !!out[k]; if (ok) pass++;
    return `${ok ? 'PASS' : 'FAIL'}  ${k.padEnd(13)} ${desc}`;
  });
  console.log('--- 后台左侧导航探针 ---');
  lines.forEach(l => console.log(l));
  console.log('navBox=' + JSON.stringify(out.navBox) + ' viewBox=' + JSON.stringify(out.viewBox));
  console.log('topbar: kb=' + out.cKb + ' rule=' + out.cRule + ' ai=' + out.cAi);
  console.log('dbg inline=' + out.dbgInline + ' gcAi=' + out.dbgGcAi + ' topVar=' + out.dbgTopVar + ' topBg=' + out.dbgTopBg);
  console.log('onItem=' + JSON.stringify(out.onItem) + ' gcs=' + out.gcsVal + ' curG=' + out.curG + ' persist=' + out.persistVal);
  console.log('rxDbg=' + JSON.stringify(out.rxDbg));
  console.log(`${pass}/${CHECKS.length} ${pass === CHECKS.length ? 'ALL_OK' : 'HAS_FAIL'}`);
  app.quit();
  process.exit(pass === CHECKS.length ? 0 : 1);
});
