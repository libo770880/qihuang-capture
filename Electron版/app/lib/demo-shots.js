// lib/demo-shots.js - 软件演示截图流水线（--demo-shots 启动参数触发，跑完自动退出）
// 策略：--in-process-gpu 下常规窗口 capturePage/executeJavaScript 不可靠（探针实测超时/空图），
//       故全部改用 offscreen 离屏渲染窗口（软件光栅化，不依赖屏幕合成），复用 renderer 页面与 preload。
// 镜1/2/3（悬浮球+EMR 背景）由无头 Chrome 复刻渲染，不在本流水线内。
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const OUT = 'C:/Users/Administrator/WorkBuddy/2026-09-09-10-13-42/tcm-competition/demo-shots';
const APP_ROOT = 'C:/Users/Administrator/WorkBuddy/2026-09-09-10-13-42/tcm-competition/capture-tool';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let LOG = '';
function log(m) {
  LOG += `[${new Date().toISOString().slice(11, 19)}] ${m}\n`;
  try { fs.writeFileSync(path.join(OUT, '_pipeline.log'), LOG); } catch (e) { /* ignore */ }
}
function save(name, buf) {
  fs.writeFileSync(path.join(OUT, name), buf);
  log('saved ' + name + ' (' + buf.length + 'B)');
}

// 看门狗：单步超时不阻塞后续（胜出后败者照常落地）
function step(name, ms, fn) {
  return Promise.race([
    fn().then(v => { log('step ' + name + ' ok'); return v; }, e => { log('step ' + name + ' ERR: ' + (e && e.message || e)); }),
    sleep(ms).then(() => { log('step ' + name + ' TIMEOUT'); })
  ]);
}

// 离屏窗口：载入 renderer 页面，返回 win（渲染完毕后 resolve）
// 策略自适应：S1 offscreen + loadURL → S2 隐藏窗 paintWhenInitiallyHidden → S3 showInactive 可见窗
const { pathToFileURL } = require('url');
async function probeWin(win) {
  const pv = await Promise.race([
    win.webContents.executeJavaScript('1+1'),
    sleep(8000).then(() => 'T')
  ]);
  const img = await Promise.race([
    win.webContents.capturePage(),
    sleep(8000).then(() => null)
  ]);
  const cs = img ? (img.getSize().width + 'x' + img.getSize().height) : 'null';
  log('  probe detail: eval=' + pv + ' capture=' + cs);
  return pv === 2 && !!(img && img.getSize().width > 0);
}

async function offwin(htmlFile, w, h) {
  const url = pathToFileURL(path.join(APP_ROOT, 'renderer', htmlFile)).href;
  const basePrefs = {
    preload: path.join(APP_ROOT, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    backgroundThrottling: false
  };
  const attempts = [
    ['S1 offscreen', { width: w, height: h, show: false, frame: false, webPreferences: { ...basePrefs, offscreen: true } }],
    ['S2 hidden-paint', { width: w, height: h, show: false, frame: false, webPreferences: { ...basePrefs, paintWhenInitiallyHidden: true } }],
    ['S3 showInactive', { width: w, height: h, show: false, frame: false, webPreferences: { ...basePrefs } }]
  ];
  for (const [name, opts] of attempts) {
    try {
      const win = new BrowserWindow(opts);
      await win.loadURL(url);
      await sleep(800);
      if (name === 'S3 showInactive') win.showInactive();
      const ok = await probeWin(win);
      log('offwin ' + name + ' probe: ' + (ok ? 'PASS' : 'FAIL'));
      if (ok) return win;
      win.destroy();
    } catch (e) {
      log('offwin ' + name + ' load ERR: ' + (e && e.message || e));
    }
  }
  throw new Error('all window strategies failed for ' + htmlFile);
}

// 按 CSS 元素矩形裁剪（多选择器回退；裁剪结果过小视为未命中）
async function shotCrop(name, win, selectors, pad = 6) {
  const wc = win.webContents;
  const list = Array.isArray(selectors) ? selectors : [selectors];
  for (const selector of list) {
    const info = await wc.executeJavaScript(`(async () => {
      let el;
      if (${JSON.stringify(selector)} === '@rxs-compliance') {
        el = [...document.querySelectorAll('.rxs')].find(e => e.textContent.includes('处方合规分析')) || document.querySelector('.rxs');
      } else {
        el = document.querySelector(${JSON.stringify(selector)});
      }
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      await new Promise(r => setTimeout(r, 350));
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, iw: window.innerWidth, ih: window.innerHeight };
    })()`);
    if (!info || info.w < 20 || info.h < 20) { log('crop MISS ' + selector); continue; }
    const img = await wc.capturePage();
    const s = Math.max(1, img.getSize().width / info.iw);
    const cx = Math.max(0, Math.round((info.x - pad) * s));
    const cy = Math.max(0, Math.round((info.y - pad) * s));
    const rect = {
      x: cx, y: cy,
      width: Math.max(1, Math.min(img.getSize().width - cx, Math.round((info.w + pad * 2) * s))),
      height: Math.max(1, Math.min(img.getSize().height - cy, Math.round((info.h + pad * 2) * s)))
    };
    const png = img.crop(rect).toPNG();
    if (png.length < 1500) { log('crop TINY ' + selector + ' (' + png.length + 'B)'); continue; }
    save(name, png);
    return true;
  }
  return false;
}

async function shotWin(name, win) {
  const img = await win.webContents.capturePage();
  if (!img || img.getSize().width === 0) { log('shotWin EMPTY ' + name); return null; }
  save(name, img.toPNG());
  return img;
}

async function run() {
  log('=== demo-shots pipeline (offscreen) start ===');
  let pw = null, panel = null, admin = null;
  try {
    // ---------- 探针 ----------
    const probe = await offwin('floatball.html', 300, 300);
    const pv = await Promise.race([
      probe.webContents.executeJavaScript('1+1'),
      sleep(10000).then(() => 'EVAL_TIMEOUT')
    ]);
    log('probe offscreen eval: ' + pv);
    const pimg = await Promise.race([
      probe.webContents.capturePage(),
      sleep(10000).then(() => null)
    ]);
    log('probe offscreen capture: ' + (pimg ? pimg.getSize().width + 'x' + pimg.getSize().height : 'EMPTY'));
    if (pv !== 2) { log('FATAL: offscreen eval unavailable'); return; }

    // ---------- 镜4：粘贴采集框 ----------
    pw = await offwin('pastebox.html', 580, 600);
    const DEMO_TEXT = fs.readFileSync(path.join(OUT, '_demo_text.txt'), 'utf8');
    const esc = DEMO_TEXT.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    await step('shot04', 30000, async () => {
      await pw.webContents.executeJavaScript(`
        document.getElementById('txt').value = \`${esc}\`;
        document.getElementById('txt').dispatchEvent(new Event('input', { bubbles: true }));
        "ok"`);
      await sleep(1500);
      await shotWin('shot04.png', pw);
    });

    // ---------- 镜5~11、14：记录面板（1100x720） ----------
    // 重置演示记录为「未分析」态，保证本地分析真实走一遍引擎
    // 注意：记录已统一存 data.db（#148 起），不能再读写 records/*.json（已迁移为 .migrated）
    try {
      const DB = require('./db');
      const DROP = ['tcm', 'compliance', 'analyzedAt', 'rxAddedAt', 'editedAt', 'diagCheck'];
      let done = false;
      for (const id of ['demo-tanshi-0901', 'a8a4df3d-84b3-4fc7-b47c-f9eb16db080a']) {
        if (!DB.recGet(id)) continue;
        const patch = {};
        for (const k of DROP) patch[k] = undefined; // JSON.stringify 丢弃 undefined 键 → 等价于删字段
        DB.recPatch(id, patch);
        log('demo record reset to un-analyzed: ' + id);
        done = true;
        break;
      }
      if (!done) log('demo record not found (data.db): demo-tanshi-0901 / a8a4df3d-…');
    } catch (e) { log('reset ERR: ' + e.message); }
    panel = await offwin('panel.html', 1100, 720);
    const pc = panel.webContents;
    await step('select-rec', 20000, async () => {
      const rid = await pc.executeJavaScript(`(async () => {
        records = await window.qhjf.listRecords();
        cur = records.find(r => r.id === 'demo-tanshi-0901') || records[0];
        renderDetail(); renderList();
        return cur ? cur.id : 'none';
      })()`);
      log('selected record: ' + rid);
      await sleep(1000);
    });

    // 镜5：详情顶部（脱敏+分块）
    await step('shot05', 25000, async () => {
      const imgP = await pc.capturePage();
      const info = await pc.executeJavaScript('(() => { const m = document.getElementById("main").getBoundingClientRect(); return { x: m.x, w: m.width, iw: innerWidth }; })()');
      const s = imgP.getSize().width / info.iw;
      save('shot05.png', imgP.crop({ x: Math.round(info.x * s), y: 0, width: Math.round(info.w * s), height: Math.round(660 * s) }).toPNG());
    });

      // 镜7~10：真实引擎本地分析
      await step('analyze', 90000, async () => {
        log('running wbRunLocal ...');
        const r7 = await pc.executeJavaScript('(async () => { try { await wbRunLocal(); return "done"; } catch (e) { return "err:" + e.message; } })()');
        log('wbRunLocal -> ' + r7);
        await sleep(1500);
        await pc.executeJavaScript(`(async () => {
          const fresh = await window.qhjf.getRecord(cur.id);
          if (fresh) { cur = fresh; }
          renderDetail();
          return "ok";
        })()`);
        await sleep(1000);
        log('tcm card present: ' + await pc.executeJavaScript('!!document.querySelector(".tcm")')
          + ' | recs: ' + await pc.executeJavaScript('!!document.querySelector(".tcm.recs")')
          + ' | rxs: ' + await pc.executeJavaScript('!!document.querySelector(".rxs")')
          + ' | comp: ' + await pc.executeJavaScript('!!document.querySelector(".comp")'));
      });
      await step('shot07', 25000, async () => { await shotCrop('shot07.png', panel, '.tcm:not(.recs)', 8); });
      await step('shot09', 20000, async () => { await shotCrop('shot09.png', panel, '.tcm:not(.recs) .tch', 8); });
      await step('shot06', 20000, async () => {
        const ok = await shotCrop('shot06.png', panel, ['.comp', '.seal'], 8);
        if (!ok) log('shot06 all selectors missed');
      });
      await step('shot10', 20000, async () => {
        const ok = await shotCrop('shot10.png', panel, ['@rxs-compliance', '.rxs', '.comp'], 8);
        if (!ok) await shotWin('shot10.png', panel);
      });

      // 镜8：推荐参考区（用相符的胸痹记录：血府逐瘀汤首选）；容器高于视口，先临时加高窗口
      await step('shot08', 30000, async () => {
        await pc.executeJavaScript(`(async () => {
          records = await window.qhjf.listRecords();
          cur = records.find(r => r.id === 'a8a4df3d-84b3-4fc7-b47c-f9eb16db080a') || cur;
          renderDetail(); renderList();
          return "ok";
        })()`);
        await sleep(1000);
        try { panel.setContentSize(1100, 1900); await sleep(600); } catch (e) { /* ignore */ }
        const ok = await shotCrop('shot08.png', panel, ['.tcm.recs', '.recs'], 8);
        try { panel.setContentSize(1100, 720); await sleep(400); } catch (e) { /* ignore */ }
        if (!ok) log('shot08 all selectors missed');
      });

    // 镜11：中药详解弹窗（展开一味药）
    await step('shot11', 30000, async () => {
      await pc.executeJavaScript('openHerbsModal(); "ok"');
      await sleep(900);
      await pc.executeJavaScript(`(() => { const d = document.querySelector('.hmodal details summary'); if (d) d.click(); return "ok"; })()`);
      await sleep(600);
        await shotWin('shot11.png', panel);
        await pc.executeJavaScript(`(() => {
          if (typeof closeHerbModal === 'function') { closeHerbModal(); return "ok"; }
          const m = document.getElementById('hmask'); if (m && m.parentNode) m.parentNode.removeChild(m);
          return "ok";
        })()`);
      await sleep(400);
    });

    // 镜14：记录列表视图
    await step('shot14', 25000, async () => {
      await pc.executeJavaScript('(async () => { cur = null; await refresh(); return "ok"; })()');
      await sleep(1200);
      await shotWin('shot14.png', panel);
    });

    // ---------- 镜12/13：后台管理（1240x800） ----------
    admin = await offwin('admin.html', 1240, 800);
    const ac = admin.webContents;
    await sleep(1500);
    await step('shot12', 25000, async () => { await shotWin('shot12.png', admin); });
    await step('shot13', 40000, async () => {
      // impHerbRes 容器在静态 HTML 中缺失（importNow 会报错），
      // 直接调 kbImport + 页面自有 toast，视觉与真实导入一致
      await ac.executeJavaScript(`(() => {
        switchView('import');
        const ta = document.getElementById('impHerbText');
        ta.value = '[{"name":"淡豆豉(演示)","category":"解表药","nature":"辛、甘、微苦，凉","actions":"解表除烦","usage":"6-12g","note":"演示导入条目","source":"演示数据"}]';
        return "ok";
      })()`);
      await sleep(800);
      await ac.executeJavaScript(`(async () => {
        try {
          const arr = JSON.parse(document.getElementById('impHerbText').value);
          const r = await window.qhjf.kbImport('herb', arr);
          toast(r && r.ok ? '导入成功，引擎已热更新' : '导入失败：' + ((r && r.error) || '未知'));
          if (typeof refreshAll === 'function') await refreshAll();
        } catch (e) { toast('导入异常：' + e.message); }
        return "ok";
      })()`);
      await sleep(1000);
      await shotWin('shot13.png', admin);
      try { await ac.executeJavaScript('(async () => { await window.qhjf.kbRemove("herb", "淡豆豉(演示)"); return "ok"; })()'); } catch (e) { /* ignore */ }
    });

    log('=== pipeline done ===');
  } catch (e) {
    log('FATAL: ' + (e && e.stack || e));
  } finally {
    try { pw && pw.destroy(); } catch (e) { /* ignore */ }
    try { panel && panel.destroy(); } catch (e) { /* ignore */ }
    try { admin && admin.destroy(); } catch (e) { /* ignore */ }
    await sleep(500);
    app.quit();
  }
}

module.exports = { run };
