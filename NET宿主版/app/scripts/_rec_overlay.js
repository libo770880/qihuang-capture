// scripts/_rec_overlay.js - 悬浮球 / 框选采集 / 中药药卡 动图录制（独立宿主，fixture IPC）
// 这三个界面走 main.js 真实链路会触发真实截屏/OCR，不适合无人值守录制；
// 这里复刻 ui_probe_overlay 的做法：真实 renderer 页面 + 演示数据夹具，画面与真实使用完全一致。
// 用法：electron scripts/_rec_overlay.js [--only=ball,region,herbcard]
const { app, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Recorder, openWin, sleep, OUT } = require('../lib/rec-core');

const ROOT = path.join(__dirname, '..');
const BG_FILE = 'C:/Users/Administrator/WorkBuddy/2026-09-09-10-13-42/tcm-competition/demo-shots/bg.png';
const only = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || '';

// ---------- fixture：与真实界面渲染字段一一对应 ----------
ipcMain.handle('overlay:selected', async () => ({ ok: true }));
ipcMain.handle('overlay:cancel', async () => ({ ok: true }));
ipcMain.handle('overlay:herb-info', async () => ({
  ok: true,
  herbs: ['桃仁', '红花', '当归', '生地黄', '川芎', '赤芍', '牛膝', '桔梗', '柴胡', '枳壳', '甘草'],
  cards: [
    { n: '桃仁', cat: '活血化瘀药', prop: '苦、甘，平；归心、肝、大肠经', fx: '活血祛瘀，润肠通便，止咳平喘', use: '5-10g，捣碎煎服', note: '孕妇慎用', dose: '12g', tox: 0, pre: 0 },
    { n: '红花', cat: '活血化瘀药', prop: '辛，温；归心、肝经', fx: '活血通经，祛瘀止痛', use: '3-10g', note: '孕妇禁用；月经过多者慎', dose: '9g', tox: 0, pre: 0 },
    { n: '当归', cat: '补虚药', prop: '甘、辛，温；归肝、心、脾经', fx: '补血活血，调经止痛，润肠通便', use: '6-12g', note: '湿盛中满、大便溏泄者慎', dose: '9g', tox: 0, pre: 0 },
    { n: '生地黄', cat: '清热药', prop: '甘、苦，寒；归心、肝、肾经', fx: '清热凉血，养阴生津', use: '9-15g', note: '脾虚便溏者不宜', dose: '9g', tox: 0, pre: 0 },
    { n: '川芎', cat: '活血化瘀药', prop: '辛，温；归肝、胆、心包经', fx: '活血行气，祛风止痛', use: '3-10g', note: '阴虚火旺者慎', dose: '5g', tox: 0, pre: 0 },
    { n: '赤芍', cat: '清热药', prop: '苦，微寒；归肝经', fx: '清热凉血，散瘀止痛', use: '6-12g', note: '不宜与藜芦同用', dose: '6g', tox: 0, pre: 0 },
    { n: '牛膝', cat: '活血化瘀药', prop: '苦、甘、酸，平；归肝、肾经', fx: '逐瘀通经，补肝肾，强筋骨', use: '5-12g', note: '孕妇慎用', dose: '9g', tox: 0, pre: 0 },
    { n: '桔梗', cat: '化痰止咳平喘药', prop: '苦、辛，平；归肺经', fx: '宣肺，祛痰，排脓', use: '3-10g', note: '阴虚久嗽者慎', dose: '5g', tox: 0, pre: 0 },
    { n: '柴胡', cat: '解表药', prop: '苦，微寒；归肝、胆经', fx: '疏散退热，疏肝解郁，升举阳气', use: '3-10g', note: '肝阳上亢者忌', dose: '3g', tox: 0, pre: 0 },
    { n: '枳壳', cat: '理气药', prop: '苦、辛、酸，微寒；归脾、胃经', fx: '理气宽中，行滞消胀', use: '3-10g', note: '孕妇慎用', dose: '6g', tox: 0, pre: 0 },
    { n: '甘草', cat: '补虚药', prop: '甘，平；归心、肺、脾、胃经', fx: '补脾益气，清热解毒，祛痰止咳，缓急止痛，调和诸药', use: '2-10g', note: '不宜与海藻、京大戟、甘遂、芫花同用', dose: '3g', tox: 0, pre: 0 },
  ],
  preds: [{
    n: '血府逐瘀汤', origin: '《医林改错》', m: '胸中血瘀证', s: ['气滞血瘀', '胸中血瘀'],
    comp: '桃仁12g、红花9g、当归9g、生地黄9g、川芎5g、赤芍6g、牛膝9g、桔梗5g、柴胡3g、枳壳6g、甘草3g',
    hit: ['桃仁', '红花', '当归', '生地黄', '川芎', '赤芍', '牛膝', '桔梗', '柴胡', '枳壳', '甘草'],
    miss: [], inter: 11, compSize: 11, covF: 100, covRx: 100, classic: true
  }],
  usage: '7剂，日一剂，水煎400ml，早晚分服',
  type: 'drugs', typeLabel: '药品 · 用法说明与合规分析', msg: '演示数据'
}));

function bgDataUrl() {
  const b = fs.readFileSync(BG_FILE);
  return 'data:image/png;base64,' + b.toString('base64');
}

// ---------- 场景 A：悬浮球（宽屏 16:9，HIS 底图无拉伸） ----------
async function sceneBall() {
  const win = await openWin('floatball.html', 1280, 720, { transparent: true });
  // 宽屏演示：悬浮球靠左垂直居中，菜单展开为旁边的浮动卡片（只调位置，不动 DOM/事件）
  await win.webContents.executeJavaScript(`(function(){
    const st = document.createElement('style');
    st.textContent = '#view-ball{justify-content:flex-start;padding-left:96px}' +
      '#view-menu .menu{inset:auto;left:82px;top:50%;transform:translateY(-50%);width:330px;height:588px}';
    document.head.appendChild(st); return 1;
  })()`);
  const r = new Recorder('01-启动与悬浮球', win, 10);
  const js = r.js;
  await sleep(900);
  r.__metaBg = 'his';
  await r.start();
  r.mark('① 常驻悬浮球：一键唤醒，不干扰 HIS 操作');
  await r.wait(1400);
  r.mark('② 点击展开功能菜单');
  await js(`document.getElementById('ball').click(); true`);
  await r.wait(1300);
  r.mark('③ 粘贴采集 / 框选抓取 / 拍照识别 / 记录面板 / 辨证咨询…');
  await r.wait(1600);
  r.mark('④ Ctrl+Alt+V：复制即入库，零识别误差');
  await r.wait(1800);
  const meta = await r.stop();
  win.destroy();
  return meta;
}

// ---------- 场景 B：框选采集 ----------
async function sceneRegion() {
  const win = await openWin('overlay.html', 1280, 800, { transparent: true });
  const r = new Recorder('02-框选采集', win, 10);
  const js = r.js;
  win.webContents.send('overlay:bg', bgDataUrl());
  await r.until(`!document.body.classList.contains('pre')`, 8000);
  await sleep(600);
  await r.start();
  r.mark('① 唤起框选：HIS 界面被冻结为底图');
  await r.wait(1200);
  r.mark('② 按住鼠标拖拽，框住处方区域');
  // 处方卡片在底图 (139,623)-(1499,822) → 窗口 CSS (92,462)-(1000,609)（1280×800 / 拉伸铺满口径）
  await r.mouseAt('mousedown', 110, 470);
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    const x = 110 + Math.round((880 - 110) * i / steps) + (i % 3 === 2 ? 6 : 0);
    const y = 470 + Math.round((600 - 470) * i / steps) + (i % 4 === 1 ? 5 : 0);
    await r.mouseAt('mousemove', x, y);
    await sleep(85);
  }
  await r.mouseAt('mouseup', 880, 600);
  await r.wait(600);
  r.mark('③ 8 个把手可微调选区，工具条自动贴边');
  await r.wait(1600);
  r.mark('④ 点 ✓ 提交：处方文本入库并自动分析');
  await r.click(`#bar .tb[data-k="ok"]`, { after: 900 });
  r.mark('⑤ 采集完成 → 记录面板查看结果');
  await r.wait(1500);
  const meta = await r.stop();
  win.destroy();
  return meta;
}

// ---------- 场景 C：中药药卡 ----------
async function sceneHerbCard() {
  const win = await openWin('overlay.html', 1280, 800, { transparent: true });
  const r = new Recorder('03-中药药卡', win, 10);
  const js = r.js;
  win.webContents.send('overlay:bg', bgDataUrl());
  await r.until(`!document.body.classList.contains('pre')`, 8000);
  await sleep(500);
  // 先框住 RP 处方行（底图 (139,623)-(1499,822) → 窗口 CSS，拉伸铺满口径）
  await r.mouseAt('mousedown', 120, 465);
  for (let i = 1; i <= 10; i++) {
    await r.mouseAt('mousemove', 120 + Math.round((860 - 120) * i / 10), 465 + Math.round((605 - 465) * i / 10));
    await sleep(60);
  }
  await r.mouseAt('mouseup', 860, 605);
  await r.wait(700);
  await r.start();
  r.mark('① 框住处方行，点工具条「药」');
  await r.wait(900);
  r.mark('② 实时识别药味：说明 · 用法 · 注意事项');
  await r.click(`#bar .tb.tcmbtn`, { after: 1200 });
  r.mark('③ 逐味卡片：性味归经 · 功效 · 常用量 · 毒性提醒');
  await r.wait(2000);
  r.mark('④ 医保属性：甲/乙/丙/自费 一目了然');
  await r.wait(1800);
  r.mark('⑤ 预判方剂：与知识库组成比对重合度');
  await r.wait(2200);
  const meta = await r.stop();
  win.destroy();
  return meta;
}

const SCENES = { ball: sceneBall, region: sceneRegion, herbcard: sceneHerbCard };

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const names = (only || Object.keys(SCENES).join(',')).split(',').filter(Boolean);
  for (const n of names) {
    try {
      const m = await SCENES[n]();
      console.log('[rec] scene ' + n + ' result: ' + (m ? 'meta' : 'null'));
      if (m) {
        m.bg = 'his';   // 透明窗口场景：合成时垫 HIS 底图复原真实遮罩视觉
        const dir = path.join(OUT, m.name || n);   // Recorder 目录名 = 场景中文名
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(m, null, 1));
        console.log('[rec] scene ' + n + ' -> frames=' + m.frames);
      }
    } catch (e) { console.log('[rec] scene ' + n + ' ERR ' + (e && e.stack || e)); }
  }
  await sleep(300);
  app.exit(0);
});
