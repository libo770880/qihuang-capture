/**
 * UI 现代化 · 离线截图取证
 * ------------------------------------------------------------
 * 用途：不启动完整应用，直接用 Electron 承载 renderer/*.html 截图，用于
 *           逐轮校对视觉（配色 / 留白 / 卡片 / 字重），替代肉眼猜测。
 *
 * 关键：preload 不是 mock 假数据 —— 它直连用户目录里的真实 data.db，
 *           因此列表、详情、统计都是真实内容，视觉结论才可信。
 *
 * 用法：
 *   <electron> scripts/_ui_shot.js                 # 截全部页面
 *   <electron> scripts/_ui_shot.js panel admin     # 只截指定页
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.probe', 'ui');
const APPDATA = process.env.APPDATA || '';
const USER = path.join(APPDATA, '岐黄鉴方·悬浮采集助手');

const PAGES = {
  panel:    { w: 1440, h: 900, wait: 2600 },
  admin:    { w: 1440, h: 940, wait: 2600 },
  consult:  { w: 1180, h: 860, wait: 2200 },
  ai:       { w: 760,  h: 820, wait: 1800 },
  pastebox: { w: 760,  h: 560, wait: 1600 },
  photo:    { w: 900,  h: 640, wait: 1600 },
  search:   { w: 1100, h: 780, wait: 1600 },
};

async function shoot(name) {
  const cfg = PAGES[name];
  const win = new BrowserWindow({
    width: cfg.w, height: cfg.h, show: false,
    backgroundColor: '#f4f7f5',
    webPreferences: {
      preload: path.join(__dirname, '_shot_preload.js'),
      contextIsolation: false,
      sandbox: false,
      nodeIntegration: false,
    },
  });
  const errs = [];
  win.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) errs.push(String(msg).slice(0, 160));
  });
  await win.loadFile(path.join(ROOT, 'renderer', name + '.html'));
  await new Promise(r => setTimeout(r, cfg.wait));
  const img = await win.webContents.capturePage();
  const file = path.join(OUT, name + '.png');
  fs.writeFileSync(file, img.toPNG());
  console.log(`  ${name.padEnd(9)} -> ${file}  (${Math.round(img.getSize().width)}x${img.getSize().height})`);

  // —— 计算样式取证：换肤是否真正生效，用数值说话 ——
  const styleJson = await win.webContents.executeJavaScript(`(function(){
    function cs(el, props){ if(!el) return null; const s=getComputedStyle(el); const o={};
      for(const p of props) o[p]=s.getPropertyValue(p); return o; }
    const grads=[];
    for(const el of document.querySelectorAll('body, body *')){
      const bi=getComputedStyle(el).backgroundImage;
      if(bi && bi!=='none' && /gradient\\(/.test(bi)){
        grads.push((el.tagName.toLowerCase())+(el.className&&typeof el.className==='string'?'.'+el.className.split(' ').slice(0,2).join('.'):'')+' :: '+bi.slice(0,80));
        if(grads.length>=12) break;
      }
    }
    const q=s=>document.querySelector(s);
    return JSON.stringify({
      body: cs(document.body, ['background-color','color','font-size','font-family','line-height']),
      top:  cs(q('.top'), ['height','background-color','background-image']),
      side: cs(q('.side'), ['background-color','border-right-color','width']),
      tabOn:cs(q('.tab.on'), ['color','border-bottom-color']),
      grads, gradCount: grads.length,
    });
  })()`);
  try {
    const st = JSON.parse(styleJson);
    fs.writeFileSync(path.join(OUT, name + '.styles.json'), JSON.stringify(st, null, 1));
    console.log(`     body=${st.body && st.body['background-color']}  top=${st.top && st.top['background-color']}  残留渐变=${st.gradCount}`);
    if (st.gradCount) console.log('       ' + st.grads.slice(0, 4).join('\n       '));
  } catch (e) { console.log('     样式取证失败: ' + e.message); }

  if (errs.length) console.log(`     控制台告警 ${errs.length} 条：\n       ` + errs.slice(0, 6).join('\n       '));
  win.destroy();
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const want = process.argv.slice(2).filter(a => PAGES[a]);
  const list = want.length ? want : Object.keys(PAGES);
  fs.mkdirSync(OUT, { recursive: true });
  console.log('用户数据目录：' + USER);
  console.log('输出目录：' + OUT + '\n');
  for (const p of list) {
    try { await shoot(p); }
    catch (e) { console.log(`  ${p} 失败：${e.message}`); }
  }
  console.log('\n完成。');
  app.quit();
});
