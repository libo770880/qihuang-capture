// 探针：AI 清理规则「常用」预设点击反馈（正则预设须自动展开「高级」框并提示）
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
const SHOT_DIR = path.join(__dirname, '..', '.probe', 'ui');
fs.mkdirSync(SHOT_DIR, { recursive: true });

// admin.html 依赖的 IPC 最小集（探针只测「常用」区交互，AI 配置给空壳）
ipcMain.handle('ai:config-get', () => ({ models: [] }));
ipcMain.handle('panel:list', () => []);
for (const ch of ['ref:meta', 'ref:list', 'ref:search', 'sys:get', 'userkb:list', 'records:list', 'kb:list']) {
  try { ipcMain.handle(ch, () => (ch === 'ref:meta' ? [] : [])); } catch (e) { /* 已注册则忽略 */ }
}

const CHECKS = [
  ['presetsRendered', '常用区 15 个预设按钮全部渲染（含 HIS 医保列 6 个）'],
  ['cutPresetWorks', '点普通词预设 → 进入①②清单小方块'],
  ['cutPresetDup', '重复点同一预设 → 提示「不用重复添加」'],
  ['advPresetOpens', '点正则预设 → 「高级」框自动展开'],
  ['advPresetNoted', '高级框下方出现绿色已加入提示'],
  ['advPresetValue', '正则表达式确实写进了高级框'],
  ['advPresetDup', '重复点正则预设 → 提示「已在高级框里」'],
  ['hisPresetClean', 'HIS 医保列预设：「杜仲 - 15 g ✎ 0 % 报 - 煎法」清成「杜仲 15 g」'],
  ['rxTailClean', '统计尾巴+孤括号预设：去噪音且保留「每日1剂」用法'],
];
const out = {};

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1360, height: 1700, show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true }
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'admin.html'));
  const r = await win.webContents.executeJavaScript(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const r = {};
    await sleep(1000);
    // 切到 AI 页签（若有）
    const tabs = document.querySelectorAll('.tabs .tab');
    r.tabN = tabs.length;
    let aiTab = null;
    for (const t of tabs) { if (/AI 设置/.test(t.textContent || '')) { aiTab = t; break; } }
    r.foundAiTab = !!aiTab;
    if (aiTab) { aiTab.click(); }
    await sleep(800);
    r.viewAiOn = !!document.getElementById('v-ai') && document.getElementById('v-ai').classList.contains('on');
    const pres = document.querySelectorAll('#stripPresets .spill');
    r.presetsRendered = pres.length === 15;
    r.presN = pres.length;
    if (!r.presetsRendered) return r;
    // ① 普通词预设：点「「[已核对]」标记」(index 3)
    pres[3].click(); await sleep(150);
    const cutChips = document.querySelectorAll('#stripCutList .schip');
    r.cutPresetWorks = [...cutChips].some(c => c.textContent.includes('[已核对]'));
    // ② 重复点
    pres[3].click(); await sleep(100);
    const noteEl = document.getElementById('stripPreSt');
    r.cutPresetDup = !!noteEl && /不用重复添加/.test(noteEl.textContent);
    // ③ 正则预设：点「统计行「共 12 味」」(index 4)
    pres[4].click(); await sleep(250);
    const box = document.getElementById('stripAdvBox');
    r.advPresetOpens = !!box && box.open === true;
    const st = document.getElementById('aiStripSt');
    r.advPresetNoted = !!st && /已加入「高级」框/.test(st.textContent);
    const advEl = document.getElementById('aiStrip');
    // 文本含字面反斜杠，用 indexOf 比对而非正则
    r.advPresetValue = !!advEl && advEl.value.indexOf('~/^共') >= 0 && advEl.value.indexOf('味/') >= 0;
    // ④ 重复点正则预设
    pres[4].click(); await sleep(150);
    r.advPresetDup = !!st && /已在「高级」框里/.test(st.textContent);
    // ⑤ HIS 医保列预设（index 9 簇规则 + 13 横杠 + 14 ✎）：中药医嘱医保列噪声清干净、用法保留
    pres[9].click(); pres[13].click(); pres[14].click(); await sleep(150);
    const hisSample = '杜仲 - 15 g ✎ 0 % 报 - 煎法\\n每日1剂 水煎服';
    const keptHis = window.StripRules.applyText(hisSample, stripCompose()).join(' | ');
    r.hisPresetClean = keptHis.includes('杜仲 15 g') && keptHis.includes('每日1剂 水煎服')
                    && !keptHis.includes('煎法') && !keptHis.includes('报') && !keptHis.includes('%');
    // ⑥ 统计尾巴+孤括号预设：清理样例行，噪音剔除、用法保留
    pres[7].click(); pres[8].click(); await sleep(150);
    const sample = '酒大黄 3g(共14味7剂 每日1剂院内煎常规煎 分早晚两次饭后内服)';
    const kept = window.StripRules.applyText(sample, stripCompose()).join('');
    r.rxTailClean = kept.includes('酒大黄 3g') && kept.includes('每日1剂')
                 && !kept.includes('共14') && !kept.trim().endsWith('）') && !kept.trim().endsWith(')');
    return r;
  })()`);
  Object.assign(out, r);

  const img = await win.webContents.executeJavaScript(`(async () => {
    const box = document.getElementById('stripAdvBox');
    if (box) box.scrollIntoView({ block: 'center' });
    await new Promise(r => setTimeout(r, 350));
    return true;
  })()`);
  await new Promise(r => setTimeout(r, 200));
  const img2 = await win.webContents.capturePage();
  fs.writeFileSync(path.join(SHOT_DIR, 'strip-presets.png'), img2.toPNG());
  console.log('[probe] 截图 → ' + path.join(SHOT_DIR, 'strip-presets.png'));
  win.destroy();

  console.log('PROBE_JSON=' + JSON.stringify(out, null, 1));
  let ok = 0;
  console.log('\n———— 常用预设反馈探针 ————');
  CHECKS.forEach(([k, desc]) => {
    const pass = !!out[k];
    if (pass) ok++;
    console.log((pass ? '  OK  ' : ' FAIL ') + k + '  ' + desc);
  });
  console.log(`\n结果：${ok}/${CHECKS.length}` + (ok === CHECKS.length ? '  ALL_OK' : '  有失败项'));
  app.exit(0);
});
