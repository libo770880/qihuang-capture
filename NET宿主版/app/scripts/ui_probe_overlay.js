// 探针：框选遮罩 —— ①底图到货前藏提示条 ②8 个把手可拖拽调整/移动选区 ③选区外拖拽重新框选
//                ④工具条中药说明 ⑤「药」实时识别并渲染药品详情卡（说明/用法/预判方剂）
//                ⑥✓ 能正常提交（工具条在选区外，不能被「重新框选」吃掉 —— 回归项）
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
const SHOT_DIR = path.join(__dirname, '..', '.probe', 'ui');
fs.mkdirSync(SHOT_DIR, { recursive: true });

// overlay.html 用到的最小 IPC 集
let lastSelected = null;
ipcMain.handle('overlay:selected', async (e, rect, withAnno, opts) => { lastSelected = { rect, withAnno, opts }; return { ok: true }; });
ipcMain.handle('overlay:cancel', () => ({ ok: true }));;
// 「药」识别：探针不跑真实 OCR，直接喂固定夹具（真链路由 main.js 走 capture.ocrImage）
ipcMain.handle('overlay:herb-info', async (e, p) => {
  lastHerbReq = p || null;
  return {
    ok: true,
    herbs: ['大黄', '黄芪', '党参', '白术', '茯苓', '陈皮', '半夏', '甘草'],
    cards: [
      { n: '大黄', cat: '泻下药', prop: '苦寒；归脾胃大肠肝心经', fx: '泻下攻积，清热泻火，凉血解毒', use: '3-15g；泻下生用后下', note: '孕妇及月经期慎用；脾胃虚寒者忌', dose: '3g', tox: 0, pre: 1 },
      { n: '半夏', cat: '化痰止咳平喘药', prop: '辛温，有毒（制后减）', fx: '燥湿化痰，降逆止呕', use: '3-9g；制用为主', note: '反乌头；孕妇慎', dose: '9g', tox: 1, pre: 1 }
    ],
    preds: [{ n: '四君子汤', origin: '《太平惠民和剂局方》', m: '脾胃气虚证', s: ['脾气虚'], comp: '人参9g、白术9g、茯苓9g、炙甘草6g', hit: ['党参', '白术', '茯苓', '甘草'], miss: [], inter: 5, compSize: 5, covF: 100, covRx: 63, classic: true }],
    usage: '每日1剂 水煎服 分早晚两次饭后内服',
    type: 'drugs', typeLabel: '药品 · 用法说明与合规分析', msg: 'Fixture'
  };
});
let lastHerbReq = null;

// 2×2 灰色 PNG（够触发 onOverlayBg 的 load 回调即可，本探针不校验放大镜像素）
const BG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z8DAwMDAxAADjAwMAA8sAgWQ4W2nAAAAAElFTkSuQmCC';

const CHECKS = [
  ['preHidden', '底图未到货前 body.pre（提示条先藏，免得被拍进底图）'],
  ['bgArrived', '底图到货后提示条放出（pre 移除）'],
  ['handles8', '选中后 8 个把手（4 角 + 4 边中点）全部显示'],
  ['selected', '拖拽框选产生选区 300×200'],
  ['resizeSE', '拖右下角把手 → 选区右下角跟着放大'],
  ['resizeN', '拖上边中点把手 → 只改上边，下边不动'],
  ['moveRect', '选区内无工具拖拽 → 整块平移，宽高不变'],
  ['reselect', '选区外拖拽 → 直接重新框选'],
  ['tcmHint', '工具条提示条给出中药框选要点（药味行/用法行）'],
  ['tcmCard', '点「药」展开中药抓取要点卡'],
  ['tcmTitle', 'AI 按钮提示注明中药名与剂量更准'],
  // 新增：药品实时识别卡片 + ✓ 回归
  ['herbCards', '点「药」→ IPC overlay:herb-info 带上选区裁剪图'],
  ['cardRender', '卡片渲染每味药：说明/用法/注意 + 剂量徽标'],
  ['predRender', '卡片渲染预判方剂（方名 + 重合度 + 命中/缺味）'],
  ['okSubmit', '回归：点 ✓ 能提交当前选区（工具条在选区外不被「重框」吞掉）'],
];
const out = {};

function mouse(win, type, x, y, target) {
  return win.webContents.executeJavaScript(`(function(){
    const el = ${target ? `document.getElementById(${JSON.stringify(target)})` : 'document'};
    el.dispatchEvent(new MouseEvent(${JSON.stringify(type)}, {bubbles:true, cancelable:true, button:0, clientX:${x}, clientY:${y}}));
    return true;
  })()`);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1200, height: 800, show: true,   // 必须可见：隐藏窗口的 capturePage 几何不可靠
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true }
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
  await new Promise(r => setTimeout(r, 600));

  const snap = () => win.webContents.executeJavaScript(`(function(){
    return { phase: typeof phase!=='undefined'?phase:null,
             rect: rect?{x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.w),h:Math.round(rect.h)}:null,
             pre: document.body.classList.contains('pre'),
             handles: [0,1,2,3,4,5,6,7].map(i=>{const h=document.getElementById('h'+i);return h&&h.style.display==='block'?1:0}),
             barDisp: getComputedStyle(document.getElementById('bar')).display,
             hint: (document.getElementById('hint')||{}).textContent||'',
             tcmDisp: getComputedStyle(document.getElementById('tcm')).display,
             tipDisp: getComputedStyle(document.getElementById('tip')).display };
  })()`);

  // ① 底图到货前
  let s0 = await snap();
  out.preHidden = s0.pre === true && s0.tipDisp === 'none';

  // ② 投递底图
  win.webContents.send('overlay:bg', BG);
  await new Promise(r => setTimeout(r, 500));
  let s1 = await snap();
  out.bgArrived = s1.pre === false && s1.tipDisp !== 'none';

  // ③ 框选 (100,100) → (400,300)
  await mouse(win, 'mousedown', 100, 100);
  await mouse(win, 'mousemove', 250, 200);
  await mouse(win, 'mousemove', 400, 300);
  await mouse(win, 'mouseup', 400, 300);
  await new Promise(r => setTimeout(r, 200));
  let s2 = await snap();
  out.selected = !!s2.rect && s2.rect.x === 100 && s2.rect.y === 100 && s2.rect.w === 300 && s2.rect.h === 200;
  out.handles8 = s2.handles.reduce((a, b) => a + b, 0) === 8;
  out.tcmHint = /药味行/.test(s2.hint) && /用法行/.test(s2.hint);

  // ④ 拖右下角把手 se：从 (400,300) 拖到 (500,360)
  await mouse(win, 'mousedown', 400, 300, 'h3');
  await mouse(win, 'mousemove', 460, 340);
  await mouse(win, 'mousemove', 500, 360);
  await mouse(win, 'mouseup', 500, 360);
  let s3 = await snap();
  out.resizeSE = !!s3.rect && s3.rect.x === 100 && s3.rect.y === 100 && s3.rect.w === 400 && s3.rect.h === 260;

  // ⑤ 拖上边中点 n：从 y=100 拖到 y=140（下边 360 不动）
  await mouse(win, 'mousedown', 300, 100, 'h4');
  await mouse(win, 'mousemove', 300, 140);
  await mouse(win, 'mouseup', 300, 140);
  let s4 = await snap();
  out.resizeN = !!s4.rect && s4.rect.y === 140 && s4.rect.h === 220 && Math.abs((s4.rect.y + s4.rect.h) - 360) <= 1;

  // ⑥ 选区内无工具拖拽 → 整块平移 (+40,+30)
  await mouse(win, 'mousedown', 300, 250);
  await mouse(win, 'mousemove', 340, 280);
  await mouse(win, 'mouseup', 340, 280);
  let s5 = await snap();
  out.moveRect = !!s5.rect && s5.rect.x === 140 && s5.rect.y === 170 && s5.rect.w === s4.rect.w && s5.rect.h === s4.rect.h;

  // ⑦ 选区外拖拽 → 重新框选 (900,700) → (1050,780)
  await mouse(win, 'mousedown', 900, 700);
  await mouse(win, 'mousemove', 1000, 750);
  await mouse(win, 'mousemove', 1050, 780);
  await mouse(win, 'mouseup', 1050, 780);
  let s6 = await snap();
  out.reselect = !!s6.rect && s6.rect.x === 900 && s6.rect.y === 700 && s6.rect.w === 150 && s6.rect.h === 80;

  // ⑧ 工具条「药」按钮 → 展开中药要点卡
  const t0 = await win.webContents.executeJavaScript(`(function(){return getComputedStyle(document.getElementById('tcm')).display;})()`);
  await win.webContents.executeJavaScript(`(function(){document.querySelector('#bar .tb[data-k="tcm"]').click();return true;})()`);
  await new Promise(r => setTimeout(r, 200));
  const t1 = await win.webContents.executeJavaScript(`(function(){return getComputedStyle(document.getElementById('tcm')).display;})()`);
  out.tcmCard = t0 === 'none' && t1 === 'block';

  // ⑨ AI 按钮提示含中药说明
  out.tcmTitle = await win.webContents.executeJavaScript(
    `(function(){const b=document.querySelector('#bar .tb[data-k="aiocr"]');return !!b && /中药/.test(b.title);})()`);

  // ⑩ 点「药」→ 走识别通道并渲染药品卡（含预判方剂）
  {
    // 上面的 tcmCard 用例已经把面板点开过，先复位成收起态，这一下才算真的「点开并识别」
    await win.webContents.executeJavaScript(
      `(function(){bar.classList.remove('tcm-on');tcmReset();return true;})()`);
    lastHerbReq = null;
    await win.webContents.executeJavaScript(`(function(){document.querySelector('#bar .tb[data-k="tcm"]').click();return true;})()`);
    await new Promise(r => setTimeout(r, 600));
    out.herbCards = !!lastHerbReq && /^data:image\//.test(String((lastHerbReq.img) || ''));
    const body = await win.webContents.executeJavaScript(
      `(function(){const b=document.getElementById('tcmBody');return b?b.textContent:'';})()`);
    out.cardRender = /大黄/.test(body) && /说明/.test(body) && /用法/.test(body) && /注意/.test(body) && /3g/.test(body);
    out.predRender = /预判方剂/.test(body) && /四君子汤/.test(body) && /重合\s*100%/.test(body) && /命中/.test(body);
    await win.webContents.executeJavaScript(`(function(){document.querySelector('#bar .tb[data-k="tcm"]').click();return true;})()`); // 收起
  }

  // ⑪ 回归：点 ✓ 提交选区（旧实现里工具条在选区外 → mousedown 触发重新框选 → 选区被清空）
  {
    lastSelected = null;
    await win.webContents.executeJavaScript(`(function(){document.querySelector('#bar .tb[data-k="ok"]').click();return true;})()`);
    await new Promise(r => setTimeout(r, 400));
    out.okSubmit = !!lastSelected && !!lastSelected.rect && lastSelected.rect.w > 0 && lastSelected.rect.h > 0;
  }

  // 截图取证：capturePage 在带 GPU 的沙箱进程里会偶发 UnknownVizError，必须容错，
  // 否则未捕获的 rejection 会让进程停在 app.exit 之前，表现为「探针挂住」。
  try {
    const png = await win.webContents.capturePage();
    fs.writeFileSync(path.join(SHOT_DIR, 'overlay-toolbar.png'), png.toPNG());
    console.log('[probe] 截图 → ' + path.join(SHOT_DIR, 'overlay-toolbar.png'));
  } catch (e) { console.log('[probe] 截图跳过（' + (e && e.message) + '）'); }

  win.destroy();
  console.log('PROBE_JSON=' + JSON.stringify(out, null, 1));
  let ok = 0;
  console.log('\n———— 框选遮罩交互探针 ————');
  CHECKS.forEach(([k, desc]) => {
    const pass = !!out[k];
    if (pass) ok++;
    console.log((pass ? '  OK  ' : ' FAIL ') + k + '  ' + desc);
  });
  console.log(`\n结果：${ok}/${CHECKS.length}` + (ok === CHECKS.length ? '  ALL_OK' : '  有失败项'));
  app.exit(0);
});
