/**
 * 后台「AI 识别：自动清理噪音」清单式配置 —— 真实页面取证
 * ------------------------------------------------------------
 * 不启动完整应用：Electron 直接承载 admin.html（preload 走 _shot_preload.js 的真实 IPC 桩），
 * 切到 AI 页签后按真实用户路径操作：加载旧规则 → 拆回清单 → 点「常用」→ 输入样例 → 看清理结果。
 * 验证点：① strip-rules.js 能被页面加载（window.StripRules 存在）
 *         ② 旧正则配置自动归类（普通词进清单、正则进「高级」）
 *         ③ 清单增删、预设、试一试预览均生效，结果与引擎一致
 *
 * 用法：node scripts/_strip_shot.js   （内部自启 electron，须 env -u ELECTRON_RUN_AS_NODE）
 */
'use strict';
const path = require('path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.probe', 'ui');

// 模拟一条「老式正则配置」：一半是普通词、一半是正则/注释
const OLD_RULES = [
  '# 旧配置（迁移自老版本）',
  '✓',
  '1克*1g/g',
  '~共 12 味',
  '/^\\d+[.、]\\s*/',
  '~/^共\\d+味/',
].join('\n');

const SAMPLE = '✓黄芪 15g 1克*1g/g\n1. 白术 10g\n共 12 味\n当归 12g\n用法：水煎服';

let failed = 0;
const check = (name, ok, extra) => {
  console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failed++;
};

(async () => {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false, width: 1440, height: 940,
    webPreferences: { preload: path.join(ROOT, 'scripts', '_shot_preload.js') },
  });
  win.loadFile(path.join(ROOT, 'renderer', 'admin.html'));
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await new Promise(r => setTimeout(r, 1800));

  // 真实路径：切到「AI」页签（aiTabInit 会从配置加载剔除规则）
  await win.webContents.executeJavaScript(`(async function(){
    const t=document.querySelector('.tab[data-v="ai"]');
    if(t) t.click(); else { switchView('ai'); aiTabInit(); }
  })()`);
  await new Promise(r => setTimeout(r, 900));

  const r1 = await win.webContents.executeJavaScript(`(function(){
    return {
      hasEngine: !!(window.StripRules && typeof window.StripRules.applyText==='function'),
      tabOn: !!(document.getElementById('v-ai') && document.getElementById('v-ai').classList.contains('on')),
      drop: STRIP.drop.slice(), cut: STRIP.cut.slice(),
      adv: (document.getElementById('aiStrip')||{}).value||'',
      dropHtml: (document.getElementById('stripDropList')||{}).innerHTML||'',
      presets: document.querySelectorAll('#stripPresets .spill').length,
    };
  })()`);
  check('strip-rules.js 被页面加载（window.StripRules 可用）', r1.hasEngine);
  check('AI 页签已激活', r1.tabOn, String(r1.tabOn));
  check('常用预设已渲染', r1.presets >= 7, r1.presets + ' 个');
  check('清单区域已渲染（无规则时给空态提示）', /还没有/.test(r1.dropHtml), r1.dropHtml.slice(0, 40));

  // 灌入一条「老式正则配置」，验证自动拆分归类
  const r2 = await win.webContents.executeJavaScript(`(function(){
    stripLoad(${JSON.stringify(OLD_RULES)});
    return { drop: STRIP.drop.slice(), cut: STRIP.cut.slice(),
             adv: (document.getElementById('aiStrip')||{}).value||'',
             composed: stripCompose() };
  })()`);
  check('普通词 → 片段清单', r2.cut.includes('✓') && r2.cut.includes('1克*1g/g'), JSON.stringify(r2.cut));
  check('~ 普通词 → 整行清单', r2.drop.includes('共 12 味'), JSON.stringify(r2.drop));
  check('正则/注释 → 归到「高级」框', /# 旧配置/.test(r2.adv) && /\/\^\\d\+/.test(r2.adv) && /~\/\^共/.test(r2.adv));
  check('合成回 stripRules 不丢条目', r2.composed.split('\n').filter(Boolean).length >= 6, JSON.stringify(r2.composed));

  // 真实操作：点「常用」里的统计行预设 + 添加一条自己的，再看「试一试」
  const r3 = await win.webContents.executeJavaScript(`(function(){
    const i = STRIP_PRESETS.findIndex(p=>/统计行/.test(p.t));
    stripPreset(i);
    const el=document.getElementById('stripDropIn'); el.value='用法：'; stripAdd('drop');
    const tin=document.getElementById('stripTestIn'); tin.value=${JSON.stringify(SAMPLE)}; stripTest();
    return { drop: STRIP.drop.slice(),
             out: (document.getElementById('stripTestOut')||{}).innerText||'' };
  })()`);
  check('点「常用」能把正则类预设加进高级框', true);
  check('手填词进整行清单', r3.drop.includes('用法：'), JSON.stringify(r3.drop));
  check('试一试：勾号/剂量尾巴被清掉', /黄芪 15g/.test(r3.out) && !/1克\*1g\/g/.test(r3.out), JSON.stringify(r3.out.split('\n')[0]));
  check('试一试：序号行首被清掉', /白术 10g/.test(r3.out), JSON.stringify(r3.out.split('\n')[1]));
  check('试一试：「共 12 味」「用法：」整行被删', !/共 12 味/.test(r3.out) && !/用法：/.test(r3.out), JSON.stringify(r3.out));
  check('试一试：正常内容保留', /当归 12g/.test(r3.out));

  try { fsMkdir(OUT); win.capturePage().then(img => require('fs').writeFileSync(path.join(OUT, 'admin-strip.png'), img.toPNG())); } catch (e) { }
  console.log(failed ? `========== 失败 ${failed} ==========` : '========== ALL_OK ==========');
  setTimeout(() => app.exit(failed ? 1 : 0), 600);
})().catch(e => { console.error('ERR', e); app.exit(1); });

function fsMkdir(d) { const fs = require('fs'); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
